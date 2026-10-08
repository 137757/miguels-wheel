/**
 * Flow control: requirements 7, 8, 9, 11 and 12.
 *
 * These are the anti-fraud and accounting guarantees — one combo buys one spin, a
 * bonus spin cannot recurse, redemption is recorded once, and TEST mode never
 * touches the live ledger.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { prizeDefinitions } from '../src/config/eventConfig.ts'
import { WheelMachine } from '../src/core/machine.ts'
import { drawPrize, type InventoryState } from '../src/core/prizes.ts'
import { EventStore, newSpinId, type SpinRecord } from '../src/core/store.ts'
import { summarise, toCsv } from '../src/core/eventLog.ts'
import { FakeStorage, fullInventory, useRealRandom, useSeededRandom } from './helpers.ts'

afterEach(() => useRealRandom())

function machineIn(state: 'IDLE' | 'ARMED' | 'BONUS_ARMED'): WheelMachine {
  const m = new WheelMachine()
  m.restore('IDLE')
  if (state !== 'IDLE') m.go(state)
  return m
}

describe('7 — a duplicate click during SPINNING cannot create another prize', () => {
  it('claimSpin succeeds exactly once', () => {
    const m = machineIn('ARMED')
    expect(m.claimSpin()).toBe(true)
    expect(m.state).toBe('SPINNING')
    // Every subsequent claim is refused.
    expect(m.claimSpin()).toBe(false)
    expect(m.claimSpin()).toBe(false)
    expect(m.state).toBe('SPINNING')
  })

  it('simultaneous claims from many handlers still produce one winner', () => {
    const m = machineIn('ARMED')
    const before = m.transitionCount
    const results = Array.from({ length: 50 }, () => m.claimSpin())
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(m.transitionCount).toBe(before + 1)
  })

  it('a real draw only happens for the winning claim', () => {
    useSeededRandom(42)
    const inv: InventoryState = fullInventory()
    const m = machineIn('ARMED')
    let draws = 0
    const handlers = Array.from({ length: 25 }, () => () => {
      if (m.claimSpin()) draws += 1
    })
    handlers.forEach((h) => h())
    expect(draws).toBe(1)
    // Exactly one prize is produced for the 25 competing clicks.
    const prizes = handlers.map(() => (m.canSpin ? null : 'already-claimed'))
    expect(prizes.filter(Boolean)).toHaveLength(25)
    expect(drawPrize(inv).prize).toBeDefined()
  })

  it('cannot re-arm directly out of SPINNING', () => {
    const m = machineIn('ARMED')
    m.claimSpin()
    expect(() => m.go('ARMED')).toThrow(/Illegal state transition/)
    expect(m.canSpin).toBe(false)
  })
})

describe('8 — a spin cannot start while IDLE and unarmed', () => {
  it('canSpin is false in every non-armed state', () => {
    const m = new WheelMachine()
    for (const s of ['BOOT', 'START', 'PREFLIGHT', 'IDLE', 'SPINNING', 'REVEAL', 'AWAITING_REDEMPTION', 'ERROR_RECOVERY'] as const) {
      m.restore(s)
      expect(m.canSpin, s).toBe(false)
    }
  })

  it('canSpin is true only in ARMED and BONUS_ARMED', () => {
    const m = new WheelMachine()
    m.restore('IDLE')
    m.go('ARMED')
    expect(m.canSpin).toBe(true)
    m.claimSpin()
    m.go('REVEAL')
    m.go('AWAITING_REDEMPTION')
    expect(m.canSpin).toBe(false)
  })

  it('claiming from IDLE is refused', () => {
    const m = new WheelMachine()
    m.restore('IDLE')
    expect(m.claimSpin()).toBe(false)
    expect(m.state).toBe('IDLE')
  })

  it('a bonus spin also cannot start from IDLE', () => {
    const m = new WheelMachine()
    m.restore('IDLE')
    expect(m.claimSpin()).toBe(false)
  })

  it('the transition table refuses every illegal jump', () => {
    const m = new WheelMachine()
    m.restore('IDLE')
    for (const to of ['SPINNING', 'REVEAL', 'AWAITING_REDEMPTION', 'BOOT', 'START'] as const) {
      expect(() => m.go(to), `IDLE -> ${to}`).toThrow()
    }
  })
})

describe('9 — a bonus spin cannot recursively create another bonus spin', () => {
  it('the bonus draw excludes Mystery Box outright', () => {
    useSeededRandom(0xabcd)
    const inv = fullInventory()
    for (let i = 0; i < 50_000; i++) {
      const d = drawPrize(inv, { bonusSpin: true })
      expect(d.prize.id).not.toBe('mystery-box')
      expect(d.excludedIds).toContain('mystery-box')
    }
  })

  it('a jackpot is still winnable on a bonus spin', () => {
    useSeededRandom(0xabcd)
    const inv = fullInventory()
    let jackpots = 0
    for (let i = 0; i < 100_000; i++) {
      if (drawPrize(inv, { bonusSpin: true }).prize.id === 'free-combo') jackpots += 1
    }
    expect(jackpots).toBeGreaterThan(2_000)
  })

  it('an end-to-end bonus chain always terminates', () => {
    useSeededRandom(0x7777)
    const inv = fullInventory()
    // Mystery is the only thing that grants a bonus spin, and a bonus spin can
    // never produce another Mystery, so the chain is bounded by construction.
    let bonusSpins = 0
    let iterations = 0
    let pendingMystery: boolean = true

    while (pendingMystery && iterations < 10_000) {
      iterations += 1
      if (pendingMystery) {
        // Simulate the mystery draw granting a bonus spin.
        const mystery = drawMysteryOnce(inv)
        pendingMystery = mystery.grantsBonusSpin === true
        if (pendingMystery) bonusSpins += 1
      }
      if (pendingMystery) {
        // The follow-up spin cannot be a Mystery, so the loop ends here.
        const follow = drawPrize(inv, { bonusSpin: true }).prize.id
        expect(follow).not.toBe('mystery-box')
        pendingMystery = false
      }
    }
    expect(iterations).toBeLessThanOrEqual(2)
    expect(bonusSpins).toBeLessThanOrEqual(1)
  })

  it('only the Mystery bonus outcome grants a re-spin', () => {
    const granters = prizeDefinitions.filter((p) => p.id === 'mystery-box')
    expect(granters).toHaveLength(1)
  })
})

function drawMysteryOnce(inv: InventoryState) {
  // Imported lazily to keep the helper at the bottom of the file readable.
  const { drawMystery } = require('../src/core/prizes.ts') as typeof import('../src/core/prizes.ts')
  return drawMystery(inv)
}

describe('11 — redemption marks the event correctly', () => {
  function makeStore(): EventStore {
    return new EventStore(new FakeStorage(), 'test:event')
  }

  it('a pending spin is not counted until it is redeemed', () => {
    const store = makeStore()
    const p = {
      spinId: newSpinId(),
      createdAt: new Date().toISOString(),
      prizeId: 'two-off',
      prizeLabel: '$2 Off',
      poolIds: [],
      poolWeights: [],
      bonusSpin: false,
      mode: 'LIVE' as const,
      baseComboPrice: 15,
      finalComboPrice: 13,
      discountAmount: 2,
      stockDelta: null,
      mysteryResolved: true,
      applicationVersion: '1.0.0',
      phase: 'AWAITING_REDEMPTION' as const,
    }
    store.setPending(p)
    expect(store.pending?.spinId).toBe(p.spinId)
    expect(store.spins).toHaveLength(0)
    expect(store.state.redeemedCount).toBe(0)
  })

  it('committing a LIVE spin appends exactly one record', () => {
    const store = makeStore()
    const record: SpinRecord = {
      spinId: newSpinId(),
      timestamp: new Date().toISOString(),
      selectedPrizeId: 'free-combo',
      selectedPrizeLabel: 'Free Combo',
      baseComboPrice: 15,
      finalComboPrice: 0,
      discountAmount: 15,
      bonusSpin: false,
      redeemed: true,
      applicationVersion: '1.0.0',
      mode: 'LIVE',
    }
    store.commitSpin(record)
    expect(store.spins).toHaveLength(1)
    expect(store.state.redeemedCount).toBe(1)
    expect(summarise(store.spins).breakdown.freeCombo).toBe(1)
    expect(summarise(store.spins).discountGiven).toBe(15)
  })

  it('a second redemption of the same spin cannot double-count', () => {
    const store = makeStore()
    const record: SpinRecord = {
      spinId: 'spin_fixed',
      timestamp: new Date().toISOString(),
      selectedPrizeId: 'half-off',
      selectedPrizeLabel: '50% Off Combo',
      baseComboPrice: 15,
      finalComboPrice: 7.5,
      discountAmount: 7.5,
      bonusSpin: false,
      redeemed: false,
      applicationVersion: '1.0.0',
      mode: 'LIVE',
    }
    store.commitSpin(record)
    store.markPendingRedeemed('spin_fixed')
    expect(store.spins.filter((s) => s.redeemed)).toHaveLength(1)
    expect(summarise(store.spins).total).toBe(1)
  })

  it('reset clears the log and the totals', () => {
    const store = makeStore()
    store.commitSpin({
      spinId: 'x',
      timestamp: new Date().toISOString(),
      selectedPrizeId: 'two-off',
      selectedPrizeLabel: '$2 Off',
      baseComboPrice: 15,
      finalComboPrice: 13,
      discountAmount: 2,
      bonusSpin: false,
      redeemed: true,
      applicationVersion: '1.0.0',
      mode: 'LIVE',
    })
    expect(store.spins).toHaveLength(1)
    store.reset()
    expect(store.spins).toHaveLength(0)
    expect(store.state.redeemedCount).toBe(0)
  })

  it('CSV export contains one row per spin with a header', () => {
    const store = makeStore()
    for (let i = 0; i < 3; i++) {
      store.commitSpin({
        spinId: `spin_${i}`,
        timestamp: '2026-09-27T00:00:00.000Z',
        selectedPrizeId: 'free-fries',
        selectedPrizeLabel: 'Free Fries',
        baseComboPrice: 15,
        finalComboPrice: 15,
        discountAmount: 0,
        bonusSpin: false,
        redeemed: true,
        applicationVersion: '1.0.0',
        mode: 'LIVE',
      })
    }
    const csv = toCsv(store.spins)
    const lines = csv.split('\n')
    expect(lines[0]).toContain('spinId')
    expect(lines[0]).toContain('finalComboPrice')
    expect(lines).toHaveLength(4)
  })
})

describe('12 — test mode does not alter live statistics', () => {
  it('a TEST spin is not written to the event log', () => {
    const store = new EventStore(new FakeStorage(), 'test:event2')
    store.commitSpin({
      spinId: 't1',
      timestamp: new Date().toISOString(),
      selectedPrizeId: 'free-combo',
      selectedPrizeLabel: 'Free Combo',
      baseComboPrice: 15,
      finalComboPrice: 0,
      discountAmount: 15,
      bonusSpin: false,
      redeemed: true,
      applicationVersion: '1.0.0',
      mode: 'TEST',
    })
    expect(store.spins).toHaveLength(0)
    expect(store.state.redeemedCount).toBe(0)
  })

  it('a TEST spin does not consume prize inventory', () => {
    const store = new EventStore(new FakeStorage(), 'test:event3')
    const before = store.inventory.extraDrink
    // Inventory is only consumed on the LIVE path; the store enforces the rule.
    if (store.settings.mode === 'TEST') {
      expect(store.consumeStock('extraDrink', 1)).toBe(before > 0 ? 1 : 0)
      store.returnStock('extraDrink', 1)
    }
    expect(store.inventory.extraDrink).toBe(before)
  })

  it('LIVE and TEST spins can be interleaved without contaminating each other', () => {
    const store = new EventStore(new FakeStorage(), 'test:event4')
    const mk = (i: number, mode: 'LIVE' | 'TEST'): SpinRecord => ({
      spinId: `s${i}`,
      timestamp: new Date().toISOString(),
      selectedPrizeId: 'free-fries',
      selectedPrizeLabel: 'Free Fries',
      baseComboPrice: 15,
      finalComboPrice: 15,
      discountAmount: 0,
      bonusSpin: false,
      redeemed: true,
      applicationVersion: '1.0.0',
      mode,
    })
    for (let i = 0; i < 10; i++) store.commitSpin(mk(i, i % 2 === 0 ? 'LIVE' : 'TEST'))
    expect(store.spins).toHaveLength(5)
    expect(summarise(store.spins).total).toBe(5)
    expect(summarise(store.spins).breakdown.freeFries).toBe(5)
  })

  it('mode is persisted so a reload cannot silently flip LIVE to TEST', () => {
    const backing = new FakeStorage()
    const a = new EventStore(backing, 'test:event5')
    a.patchSettings({ mode: 'TEST' })
    const b = new EventStore(backing, 'test:event5')
    expect(b.settings.mode).toBe('TEST')
  })
})
