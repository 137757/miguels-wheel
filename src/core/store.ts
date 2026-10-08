/**
 * Local persistence + crash recovery.
 *
 * The single most important guarantee in this app: the prize is written to disk
 * BEFORE the wheel moves. If the laptop sleeps, Chrome crashes, or someone holds
 * the power button mid-spin, reloading restores the exact same prize. A browser
 * crash must never hand out a free second draw.
 */

import {
  appVersion,
  inventory,
  mysteryPrizeDefinitions,
  prizeDefinitions,
  ui,
  type InventoryKeyName,
  type MysteryPrizeDefinition,
  type PrizeDefinition,
} from '../config/eventConfig.ts'
import type { InventoryState } from './prizes.ts'
import type { State } from './machine.ts'

/** Deep clone helper for prize lists so store state never aliases the defaults. */
function clonePrizes(): PrizeDefinition[] {
  return JSON.parse(JSON.stringify(prizeDefinitions)) as PrizeDefinition[]
}

function cloneMystery(): MysteryPrizeDefinition[] {
  return JSON.parse(JSON.stringify(mysteryPrizeDefinitions)) as MysteryPrizeDefinition[]
}

export interface SpinRecord {
  spinId: string
  timestamp: string
  selectedPrizeId: string
  selectedPrizeLabel: string
  /** Sub-prize when the wheel landed on Mystery Box. */
  mysteryPrizeId?: string
  mysteryPrizeLabel?: string
  baseComboPrice: number
  finalComboPrice: number
  discountAmount: number
  bonusSpin: boolean
  redeemed: boolean
  applicationVersion: string
  mode: 'LIVE' | 'TEST'
}

export interface PendingSpin {
  spinId: string
  createdAt: string
  prizeId: string
  prizeLabel: string
  /** Sector pool frozen at draw time, so recovery never reshuffles the wheel. */
  poolIds: string[]
  poolWeights: number[]
  bonusSpin: boolean
  mode: 'LIVE' | 'TEST'
  baseComboPrice: number
  finalComboPrice: number
  discountAmount: number
  stockDelta: { unit: InventoryKeyName; amount: number } | null
  mysteryResolved: boolean
  mysteryPrizeId?: string
  mysteryPrizeLabel?: string
  applicationVersion: string
  /** Where the machine was when the prize was chosen. */
  phase: 'SPINNING' | 'REVEAL' | 'AWAITING_REDEMPTION'
}

export interface Settings {
  muted: boolean
  fullscreen: boolean
  mode: 'LIVE' | 'TEST'
  inventory: InventoryState
}

export interface PersistedState {
  schema: 2
  appVersion: string
  settings: Settings
  /** LIVE spins only. TEST spins never appear here. */
  spins: SpinRecord[]
  pending: PendingSpin | null
  /** Total spins redeemed, kept separately so an unredeemed pending spin cannot skew it. */
  redeemedCount: number
  eventStartedAt: string
  /** Staff-customised wheel. Null/absent means the shipped defaults. */
  prizes: PrizeDefinition[] | null
  mysteryPrizes: MysteryPrizeDefinition[] | null
  /** When the wheel layout was last edited in Settings (ISO timestamp). */
  prizesUpdatedAt: string | null
}

export function defaultInventoryState(): InventoryState {
  return {
    extraDrink: inventory.extraDrink.initial,
    extraFries: inventory.extraFries.initial,
    extraChicken: inventory.extraChicken.initial,
    sauceUpgrade: inventory.sauceUpgrade.initial,
  }
}

export function defaultState(): PersistedState {
  return {
    schema: 2,
    appVersion,
    settings: {
      muted: false,
      fullscreen: false,
      mode: 'LIVE',
      inventory: defaultInventoryState(),
    },
    spins: [],
    pending: null,
    redeemedCount: 0,
    eventStartedAt: new Date().toISOString(),
    prizes: null,
    mysteryPrizes: null,
    prizesUpdatedAt: null,
  }
}

/** A minimal Storage so tests can run without a DOM. */
export interface KeyValueStore {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

class MemoryStore implements KeyValueStore {
  #m = new Map<string, string>()
  getItem(k: string) {
    return this.#m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.#m.set(k, v)
  }
  removeItem(k: string) {
    this.#m.delete(k)
  }
}

export function resolveStore(): KeyValueStore {
  try {
    const probe = `${ui.storageKey}:probe`
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    return globalThis.localStorage
  } catch {
    // Private mode, disabled storage, or a non-DOM environment.
    return new MemoryStore()
  }
}

function isPrizeArray(v: unknown): v is PrizeDefinition[] {
  return Array.isArray(v) && v.every((p) => p && typeof p.id === 'string' && typeof p.weight === 'number')
}

function isMysteryArray(v: unknown): v is MysteryPrizeDefinition[] {
  return Array.isArray(v) && v.every((p) => p && typeof p.id === 'string' && typeof p.weight === 'number')
}

function migrate(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<PersistedState> & { schema?: unknown }
  const schema = o.schema as unknown as number
  if (schema !== 1 && schema !== 2) return null
  const base = defaultState()
  return {
    ...base,
    ...o,
    schema: 2 as const,
    settings: {
      ...base.settings,
      ...(o.settings ?? {}),
      inventory: { ...base.settings.inventory, ...(o.settings?.inventory ?? {}) },
    },
    spins: Array.isArray(o.spins) ? o.spins : [],
    prizes: isPrizeArray(o.prizes) ? o.prizes : null,
    mysteryPrizes: isMysteryArray(o.mysteryPrizes) ? o.mysteryPrizes : null,
    prizesUpdatedAt: typeof o.prizesUpdatedAt === 'string' ? o.prizesUpdatedAt : null,
  } as PersistedState
}

export class EventStore {
  #store: KeyValueStore
  #key: string
  #state: PersistedState
  /** True when the underlying store actually persists across reloads. */
  readonly durable: boolean

  constructor(store: KeyValueStore = resolveStore(), key: string = ui.storageKey) {
    this.#store = store
    this.#key = key
    this.durable = !(store instanceof MemoryStore)
    this.#state = this.#read()
  }

  #read(): PersistedState {
    try {
      const raw = this.#store.getItem(this.#key)
      if (!raw) return defaultState()
      return migrate(JSON.parse(raw)) ?? defaultState()
    } catch {
      return defaultState()
    }
  }

  get state(): PersistedState {
    return this.#state
  }

  get settings(): Settings {
    return this.#state.settings
  }

  get inventory(): InventoryState {
    return this.#state.settings.inventory
  }

  get pending(): PendingSpin | null {
    return this.#state.pending
  }

  get spins(): SpinRecord[] {
    return this.#state.spins
  }

  /** Synchronous write. Called at the exact moment the prize is chosen. */
  save(): void {
    this.#state.appVersion = appVersion
    try {
      this.#store.setItem(this.#key, JSON.stringify(this.#state))
    } catch {
      // Storage full or blocked. The prize is still held in memory and the machine
      // continues; preflight flags a non-durable store before the event starts.
    }
  }

  setPending(p: PendingSpin | null): void {
    this.#state.pending = p
    this.save()
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.#state.settings = { ...this.#state.settings, ...patch }
    this.save()
    return this.#state.settings
  }

  setInventory(next: InventoryState): void {
    this.#state.settings.inventory = { ...next }
    this.save()
  }

  /** Consume stock. Refuses to go negative. Returns the amount actually taken. */
  consumeStock(unit: InventoryKeyName, amount: number): number {
    const inv = this.#state.settings.inventory
    const have = inv[unit] ?? 0
    const taken = Math.min(have, amount)
    if (taken > 0) {
      inv[unit] = have - taken
      this.save()
    }
    return taken
  }

  returnStock(unit: InventoryKeyName, amount: number): void {
    const inv = this.#state.settings.inventory
    inv[unit] = (inv[unit] ?? 0) + amount
    this.save()
  }

  /**
   * Effective wheel prizes: staff-customised list when present, else shipped defaults.
   * Always returns a fresh array so callers cannot mutate persisted state.
   */
  getPrizes(): PrizeDefinition[] {
    const custom = this.#state.prizes
    if (custom && custom.length > 0) return JSON.parse(JSON.stringify(custom)) as PrizeDefinition[]
    return clonePrizes()
  }

  getMysteryPrizes(): MysteryPrizeDefinition[] {
    const custom = this.#state.mysteryPrizes
    if (custom && custom.length > 0) return JSON.parse(JSON.stringify(custom)) as MysteryPrizeDefinition[]
    return cloneMystery()
  }

  get isCustomWheel(): boolean {
    return Boolean(this.#state.prizes && this.#state.prizes.length > 0)
  }

  get prizesUpdatedAt(): string | null {
    return this.#state.prizesUpdatedAt
  }

  /** Persist a staff-edited wheel. Caller must validate (sum 100) first. */
  setPrizes(prizes: PrizeDefinition[], mystery: MysteryPrizeDefinition[]): void {
    this.#state.prizes = JSON.parse(JSON.stringify(prizes)) as PrizeDefinition[]
    this.#state.mysteryPrizes = JSON.parse(JSON.stringify(mystery)) as MysteryPrizeDefinition[]
    this.#state.prizesUpdatedAt = new Date().toISOString()
    this.save()
  }

  /** Drop customisation and return to the shipped wheel. */
  resetPrizes(): void {
    this.#state.prizes = null
    this.#state.mysteryPrizes = null
    this.#state.prizesUpdatedAt = null
    this.save()
  }

  /** Export the current wheel (custom or defaults) as downloadable JSON. */
  exportPrizes(): string {
    return JSON.stringify(
      { prizes: this.getPrizes(), mysteryPrizes: this.getMysteryPrizes(), exportedAt: new Date().toISOString() },
      null,
      2,
    )
  }

  /** Commits a redeemed LIVE spin into the event log. TEST spins are dropped. */
  commitSpin(record: SpinRecord): void {
    if (record.mode === 'LIVE') {
      this.#state.spins.push(record)
      this.#state.redeemedCount += 1
    }
    this.save()
  }

  markPendingRedeemed(spinId: string): void {
    const idx = this.#state.spins.findIndex((s) => s.spinId === spinId)
    if (idx >= 0) {
      this.#state.spins[idx]!.redeemed = true
      this.save()
    }
  }

  reset(): void {
    this.#state = defaultState()
    try {
      this.#store.removeItem(this.#key)
    } catch {
      /* nothing more we can do */
    }
    this.save()
  }

  /** Decide which state to resume in after a reload. */
  recoveryState(): State {
    const p = this.#state.pending
    if (!p) return 'IDLE'
    switch (p.phase) {
      case 'SPINNING':
        return 'ERROR_RECOVERY'
      case 'REVEAL':
        return 'ERROR_RECOVERY'
      case 'AWAITING_REDEMPTION':
        return 'AWAITING_REDEMPTION'
      default:
        return 'ERROR_RECOVERY'
    }
  }
}

let counter = 0
export function newSpinId(): string {
  counter += 1
  const stamp = Date.now().toString(36)
  const rand = Math.floor(Math.random() * 0xfffff).toString(36)
  return `spin_${stamp}_${counter.toString(36)}_${rand}`
}
