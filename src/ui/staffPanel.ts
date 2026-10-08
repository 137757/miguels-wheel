/**
 * Staff panel.
 *
 * Deliberately discrete, deliberately complete. Everything a stall operator needs
 * during a lunchtime is one keystroke away, and nothing here is ever visible to
 * a customer because the panel is off by default and lives behind `S`.
 */

import {
  inventory as inventoryConfig,
  mysteryPrizeDefinitions,
  type InventoryKeyName,
} from '../config/eventConfig.ts'
import { download, stamp, summarise, toCsv, toJson } from '../core/eventLog.ts'
import type { EventStore } from '../core/store.ts'

export interface StaffPanelHooks {
  arm: () => void
  next: () => void
  toggleMute: () => void
  toggleFullscreen: () => void
  testSpin: () => void
  toggleMode: () => void
  forcePrize: (id: string) => void
  reset: () => void
  openSettings: () => void
  isFullscreen: () => boolean
  isTestMode: () => boolean
  isCustomWheel: () => boolean
  audioState: () => { ready: boolean; loaded: number; total: number; errors: string[] }
  inventoryCap: (unit: InventoryKeyName) => number
  /** Called after a counter changes so the wheel can drop or restore a sector. */
  onInventoryChange: () => void
}

export class StaffPanel {
  #root: HTMLElement
  #body: HTMLElement
  #store: EventStore
  #hooks: StaffPanelHooks
  #open = false

  constructor(root: HTMLElement, body: HTMLElement, store: EventStore, hooks: StaffPanelHooks) {
    this.#root = root
    this.#body = body
    this.#store = store
    this.#hooks = hooks
  }

  get isOpen(): boolean {
    return this.#open
  }

  toggle(): void {
    this.#open ? this.close() : this.show()
  }

  show(): void {
    this.#open = true
    this.#root.hidden = false
    this.render()
  }

  close(): void {
    this.#open = false
    this.#root.hidden = true
  }

  /** Cheap guard: only rebuild when something actually changed. */
  render(): void {
    if (!this.#open) return
    const s = this.#store.state
    const sum = summarise(s.spins)
    const inv = s.settings.inventory
    const test = this.#hooks.isTestMode()
    const fs = this.#hooks.isFullscreen()
    const audio = this.#hooks.audioState()
    const pending = s.pending

    const invRows = (Object.keys(inventoryConfig) as InventoryKeyName[])
      .map((unit) => {
        const cfg = inventoryConfig[unit]
        const cap = this.#hooks.inventoryCap(unit)
        const have = inv[unit] ?? 0
        const pct = cap > 0 ? Math.max(0, Math.min(100, (have / cap) * 100)) : 0
        const out = have <= 0
        return `
        <div class="sinv__row">
          <span class="sinv__label">${cfg.label}</span>
          <span class="sinv__bar"><span class="sinv__fill" style="width:${pct}%"></span></span>
          <span class="sinv__count ${out ? 'is-out' : ''}">${have}</span>
          <span style="display:flex;gap:.2rem">
            <button class="sinv__step" data-inv="${unit}" data-delta="-1" ${have <= 0 ? 'disabled' : ''} aria-label="Decrease ${cfg.label}">−</button>
            <button class="sinv__step" data-inv="${unit}" data-delta="1" aria-label="Increase ${cfg.label}">+</button>
          </span>
        </div>`
      })
      .join('')

    const b = sum.breakdown
    const mysteryRows = mysteryPrizeDefinitions
      .map((m) => `<span>${m.label}</span><span class="sbreak__n">${b.mystery[m.id] ?? 0}</span>`)
      .join('')

    this.#body.innerHTML = `
      <section class="spanel">
        <p class="spanel__title">Session</p>
        <div class="srow"><span>Mode</span><span class="pill ${test ? 'pill--test' : 'pill--live'}">${test ? 'TEST' : 'LIVE'}</span></div>
        <div class="srow"><span>Sound</span><span class="srow__val">${s.settings.muted ? 'MUTED' : 'ON'}</span></div>
        <div class="srow"><span>Fullscreen</span><span class="srow__val">${fs ? 'ON' : 'OFF'}</span></div>
        <div class="srow"><span>Audio</span><span class="srow__val">${audio.ready ? `${audio.loaded}/${audio.total}` : 'not started'}</span></div>
        <div class="srow"><span>Storage</span><span class="srow__val">${this.#store.durable ? 'local' : 'memory only'}</span></div>
        <div class="srow"><span>Spins today</span><span class="srow__val srow__val--big">${sum.total}</span></div>
        ${
          pending
            ? `<div class="srow"><span>Unresolved spin</span><span class="srow__val srow__val--warn">${pending.prizeLabel}</span></div>`
            : ''
        }
      </section>

      <section class="spanel">
        <p class="spanel__title">Controls</p>
        <div class="sbtns">
          <button class="staff__btn staff__btn--primary" data-act="arm">Arm spin <kbd>A</kbd></button>
          <button class="staff__btn" data-act="next">Next customer <kbd>N</kbd></button>
          <button class="staff__btn" data-act="mute">Mute <kbd>M</kbd></button>
          <button class="staff__btn" data-act="fullscreen">Fullscreen <kbd>F</kbd></button>
          <button class="staff__btn" data-act="testspin">Test spin</button>
          <button class="staff__btn" data-act="mode">${test ? 'Go LIVE' : 'Go TEST'}</button>
          <button class="staff__btn staff__btn--wide" data-act="settings">⚙ Wheel settings ${this.#store.isCustomWheel ? '●' : ''}</button>
        </div>
        ${this.#store.isCustomWheel ? '<p class="spanel__note">● Custom wheel active — segments & odds edited in Settings.</p>' : '<p class="spanel__note">Wheel settings: edit segments, colours, icons and % chance. Press G anytime.</p>'}
      </section>

      <section class="spanel">
        <p class="spanel__title">Prize breakdown</p>
        <div class="sbreak">
          <span>Sauce upgrades</span><span class="sbreak__n">${b.sauceUpgrade}</span>
          <span>Free drinks</span><span class="sbreak__n">${b.freeDrink}</span>
          <span>Free fries</span><span class="sbreak__n">${b.freeFries}</span>
          <span>$2 offs</span><span class="sbreak__n">${b.twoOff}</span>
          <span>Extra chicken</span><span class="sbreak__n">${b.extraChicken}</span>
          <span>Mystery boxes</span><span class="sbreak__n">${b.mysteryBox}</span>
          <span>50% offs</span><span class="sbreak__n">${b.halfOff}</span>
          <span>Free combos</span><span class="sbreak__n">${b.freeCombo}</span>
          <span>Bonus spins</span><span class="sbreak__n">${b.bonusSpins}</span>
          ${mysteryRows}
        </div>
        <div class="srow" style="margin-top:.4rem">
          <span>Discount given</span><span class="srow__val srow__val--big">$${sum.discountGiven.toFixed(2)}</span>
        </div>
        <div class="srow"><span>Net combo takings</span><span class="srow__val">$${sum.netTakings.toFixed(2)}</span></div>
      </section>

      <section class="spanel">
        <p class="spanel__title">Prize inventory</p>
        <div class="sinv">${invRows}</div>
        <p class="spanel__note">A prize with no stock left drops off the wheel entirely — its sector and its odds both go, and the remaining odds renormalise.</p>
      </section>

      ${
        test
          ? `<section class="spanel">
              <p class="spanel__title">Force prize (test only)</p>
              <div class="sforce">
                ${this.#store.getPrizes().map((p) => `<button class="sforce__btn" data-force="${p.id}">${p.sectorLabel}</button>`).join('')}
              </div>
              <p class="spanel__note">Available only in TEST mode. There is no way to force a prize from the public screen in LIVE mode.</p>
            </section>`
          : ''
      }

      <section class="spanel">
        <p class="spanel__title">Export</p>
        <div class="sbtns">
          <button class="staff__btn" data-act="csv">Export CSV</button>
          <button class="staff__btn" data-act="json">Export JSON</button>
        </div>
        <p class="spanel__note">No names and no personal data are stored — only prize, price and time.</p>
      </section>

      <section class="spanel danger">
        <p class="spanel__title">Danger zone</p>
        <div class="danger__confirm">
          <input class="danger__input" id="resetInput" type="text" placeholder="type RESET" autocomplete="off" spellcheck="false" />
          <button class="staff__btn" data-act="reset" id="resetBtn" disabled>Reset event</button>
        </div>
        <p class="spanel__note">Clears the event log, totals and inventory. Requires typing RESET — one stray click cannot destroy the day's data.</p>
      </section>
    `

    this.#wire()
  }

  #wire(): void {
    const body = this.#body
    body.onclick = (e) => {
      const el = e.target as HTMLElement
      const act = el.closest<HTMLElement>('[data-act]')?.dataset.act
      const inv = el.closest<HTMLElement>('[data-inv]')
      const force = el.closest<HTMLElement>('[data-force]')

      if (force?.dataset.force) {
        this.#hooks.forcePrize(force.dataset.force)
        return
      }
      if (inv?.dataset.inv) {
        const unit = inv.dataset.inv as InventoryKeyName
        const delta = Number(inv.dataset.delta ?? 0)
        const next = { ...this.#store.inventory, [unit]: Math.max(0, (this.#store.inventory[unit] ?? 0) + delta) }
        this.#store.setInventory(next)
        // A sector can only exist while its prize is winnable, so the wheel has
        // to be rebuilt the moment a counter crosses zero.
        this.#hooks.onInventoryChange()
        this.render()
        return
      }
      switch (act) {
        case 'arm':
          this.#hooks.arm()
          break
        case 'next':
          this.#hooks.next()
          break
        case 'mute':
          this.#hooks.toggleMute()
          break
        case 'fullscreen':
          this.#hooks.toggleFullscreen()
          break
        case 'testspin':
          this.#hooks.testSpin()
          break
        case 'mode':
          this.#hooks.toggleMode()
          break
        case 'settings':
          this.#hooks.openSettings()
          break
        case 'csv':
          download(`miguels-wheel-${stamp()}.csv`, toCsv(this.#store.spins), 'text/csv;charset=utf-8')
          break
        case 'json':
          download(`miguels-wheel-${stamp()}.json`, toJson(this.#store.spins), 'application/json')
          break
        case 'reset':
          this.#hooks.reset()
          break
        default:
          return
      }
      this.render()
    }

    const input = this.#body.querySelector<HTMLInputElement>('#resetInput')
    const btn = this.#body.querySelector<HTMLButtonElement>('#resetBtn')
    input?.addEventListener('input', () => {
      if (btn) btn.disabled = input.value.trim().toUpperCase() !== 'RESET'
    })
    // Deliberately NOT stopping propagation: the global handler already ignores
    // shortcuts while a field has focus, and it needs to receive Escape so staff
    // can never get trapped in the panel after typing in this box.
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && btn && !btn.disabled) this.#hooks.reset()
    })
  }
}
