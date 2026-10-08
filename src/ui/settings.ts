/**
 * Wheel Settings page.
 *
 * Staff-customisable segments + percent chance. Every weight IS the percent
 * (weights must total 100), the wheel geometry is derived from the same list,
 * and the whole thing persists to localStorage so a reload keeps the layout.
 *
 * Layout: fullscreen overlay with Main / Mystery tabs, live total bar,
 * per-segment cards with sliders, and Save / Reset / Export / Import.
 */

import {
  FILLS,
  ICONS,
  prizeTiers,
  validatePrizeList,
  type MysteryPrizeDefinition,
  type PrizeDefinition,
} from '../config/eventConfig.ts'
import type { EventStore } from '../core/store.ts'

export interface SettingsHooks {
  /** Called after a successful save so the wheel rebuilds immediately. */
  onSave: () => void
  onClose: () => void
  notify: (message: string, kind?: 'info' | 'good' | 'bad') => void
}

const FILL_SWATCH: Record<string, string> = {
  dark: '#15100F',
  red: '#B31D19',
  gold: '#F6C344',
  pink: '#D93A63',
  cream: '#E6D7B4',
}

function slugify(label: string, fallback: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return s || fallback
}

function uid(): string {
  return `seg-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`
}

/**
 * Scale a weight list to whole-number percents totalling exactly 100.
 *
 * Largest-remainder rounding keeps the relative odds (ordering is preserved),
 * every segment keeps at least 1%, and the save button stays enabled after
 * add/delete instead of stranding staff on arithmetic.
 */
export function normalizeWeights<T extends { weight: number }>(list: T[]): T[] {
  const total = list.reduce((a, p) => a + (Number(p.weight) || 0), 0)
  if (list.length === 0 || total <= 0) return list
  const scaled = list.map((p) => ((Number(p.weight) || 0) / total) * 100)
  const floored = scaled.map((s) => Math.floor(s))
  let remainder = 100 - floored.reduce((a, n) => a + n, 0)
  const order = scaled
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (remainder <= 0) break
    floored[i]! += 1
    remainder -= 1
  }
  // Never strand a segment at 0%: steal from the largest.
  for (let i = 0; i < floored.length; i++) {
    if (floored[i]! < 1) {
      const donor = floored.indexOf(Math.max(...floored))
      if (floored[donor]! > 1) {
        floored[donor]! -= 1
        floored[i]! += 1
      }
    }
  }
  list.forEach((p, i) => {
    p.weight = floored[i]!
  })
  return list
}

export class SettingsPanel {
  #root: HTMLElement
  #store: EventStore
  #hooks: SettingsHooks
  #open = false
  #tab: 'main' | 'mystery' = 'main'
  #draft: PrizeDefinition[] = []
  #mysteryDraft: MysteryPrizeDefinition[] = []

  constructor(root: HTMLElement, store: EventStore, hooks: SettingsHooks) {
    this.#root = root
    this.#store = store
    this.#hooks = hooks
  }

  get isOpen(): boolean {
    return this.#open
  }

  show(): void {
    this.#draft = this.#store.getPrizes()
    this.#mysteryDraft = this.#store.getMysteryPrizes()
    this.#tab = 'main'
    this.#open = true
    this.#root.hidden = false
    this.render()
  }

  close(): void {
    this.#open = false
    this.#root.hidden = true
  }

  toggle(): void {
    this.#open ? this.close() : this.show()
  }

  render(): void {
    if (!this.#open) return
    const issues = validatePrizeList(this.#draft, this.#mysteryDraft)
    const errors = issues.filter((i) => i.level === 'error')
    const mainSum = this.#draft.reduce((a, p) => a + (Number(p.weight) || 0), 0)
    const mysterySum = this.#mysteryDraft.reduce((a, p) => a + (Number(p.weight) || 0), 0)
    const canSave = errors.length === 0
    const custom = this.#store.isCustomWheel
    const updated = this.#store.prizesUpdatedAt

    const tabBtn = (id: 'main' | 'mystery', label: string, sum: number) => `
      <button class="settab ${this.#tab === id ? 'is-active' : ''}" data-tab="${id}" type="button">
        ${label} <span class="settab__sum">${sum}%</span>
      </button>`

    const rows =
      this.#tab === 'main' ? this.#draft.map((p) => this.#mainRow(p, mainSum)).join('') : this.#mysteryDraft.map((p) => this.#mysteryRow(p, mysterySum)).join('')

    this.#root.innerHTML = `
      <div class="settings__scrim" data-act="close"></div>
      <div class="settings__card" role="dialog" aria-modal="true" aria-label="Wheel settings">
        <header class="settings__head">
          <div>
            <p class="settings__kicker">STAFF ONLY · WHEEL SETTINGS</p>
            <h2 class="settings__title">Prize wheel studio</h2>
            <p class="settings__sub">
              Weights <strong>are</strong> percents — they must total <strong>100%</strong>.
              Every slice looks the same size; the <strong>Chance %</strong> below is the real odds.
              Drag freely, then hit <strong>Auto-balance</strong>.
              ${custom ? `Custom layout saved${updated ? ` · ${new Date(updated).toLocaleString()}` : ''}.` : 'Using shipped defaults.'}
            </p>
          </div>
          <button class="settings__close" data-act="close" type="button" aria-label="Close settings">×</button>
        </header>

        <div class="settings__tabs" role="tablist">
          ${tabBtn('main', `Wheel segments (${this.#draft.length})`, mainSum)}
          ${tabBtn('mystery', `Mystery box (${this.#mysteryDraft.length})`, mysterySum)}
        </div>

        <div class="settings__total">
          <div class="settings__totalbar"><span class="settings__totalfill ${mainSum === 100 && this.#tab === 'main' ? 'is-ok' : this.#tab === 'main' ? 'is-bad' : mysterySum === 100 ? 'is-ok' : 'is-bad'}" style="width:${Math.min(100, this.#tab === 'main' ? mainSum : mysterySum)}%"></span></div>
          <span class="settings__totaltext">${this.#tab === 'main' ? mainSum : mysterySum}% / 100%</span>
        </div>

        ${errors.length ? `<ul class="settings__errors">${errors.slice(0, 6).map((e) => `<li>✕ ${e.message}</li>`).join('')}${errors.length > 6 ? `<li>… +${errors.length - 6} more</li>` : ''}</ul>` : `<p class="settings__ok">✓ Valid — every segment lands exactly as often as its % shows.</p>`}

        <div class="settings__list">${rows}</div>

        <footer class="settings__actions">
          <button class="btn btn--go" data-act="save" type="button" ${canSave ? '' : 'disabled'}>Save wheel</button>
          <button class="btn" data-act="add" type="button">+ Add segment</button>
          <button class="btn" data-act="balance" type="button" ${this.#tabTotal() === 100 ? 'disabled' : ''}>Auto-balance to 100%</button>
          <button class="btn btn--ghost" data-act="reset" type="button">Reset to defaults</button>
          <button class="btn btn--ghost" data-act="export" type="button">Export</button>
          <button class="btn btn--ghost" data-act="import" type="button">Import</button>
          <input class="settings__file" data-file="import" type="file" accept="application/json" hidden />
        </footer>
        <p class="settings__note">Tip: keep the jackpot the rarest slice. Adding or removing a segment rebalances the rest so the total stays 100%. Changes apply instantly to the wheel behind this panel after Save. Rebuild is blocked while spinning.</p>
      </div>`
    this.#wire()
  }

  /* ------------------------------------------------------------ row html --- */

  #mainRow(p: PrizeDefinition, total: number): string {
    const pct = total > 0 ? ((p.weight / total) * 100).toFixed(1) : '0.0'
    const priceKind = p.priceEffect.kind
    const priceVal =
      priceKind === 'off' ? (p.priceEffect as { amount: number }).amount
      : priceKind === 'percentOff' ? (p.priceEffect as { percent: number }).percent
      : ''
    return `
    <article class="seg" data-seg="${p.id}">
      <span class="seg__dot" style="background:${FILL_SWATCH[p.fill] ?? '#888'}"></span>
      <div class="seg__main">
        <div class="seg__row">
          <label class="seg__field seg__field--grow">Wheel text
            <input data-f="sectorLabel" value="${escapeHtml(p.sectorLabel)}" maxlength="14" placeholder="SAUCE" />
          </label>
          <label class="seg__field seg__field--grow">Prize name
            <input data-f="label" value="${escapeHtml(p.label)}" maxlength="40" placeholder="Sauce Upgrade" />
          </label>
        </div>
        <div class="seg__row">
          <label class="seg__field seg__field--chance">Chance % (weight)
            <span class="seg__chancewrap">
              <input data-f="weight" type="range" min="1" max="60" step="1" value="${p.weight}" aria-label="Chance for ${escapeHtml(p.id)}" />
              <input data-f="weightNum" type="number" min="1" max="80" step="1" value="${p.weight}" class="seg__num" />
            </span>
            <span class="seg__pct">≈ ${pct}% of spins</span>
          </label>
        </div>
        <div class="seg__row seg__row--4">
          <label class="seg__field">Colour
            <select data-f="fill">${FILLS.map((f) => `<option value="${f}" ${p.fill === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          </label>
          <label class="seg__field">Icon
            <select data-f="icon">${ICONS.map((i) => `<option value="${i}" ${p.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select>
          </label>
          <label class="seg__field">Tier
            <select data-f="tier">${prizeTiers.map((t) => `<option value="${t}" ${p.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          </label>
          <label class="seg__field">Stock
            <select data-f="stockUnit">
              <option value="" ${!p.stockUnit ? 'selected' : ''}>none (discount)</option>
              <option value="extraDrink" ${p.stockUnit === 'extraDrink' ? 'selected' : ''}>drinks</option>
              <option value="extraFries" ${p.stockUnit === 'extraFries' ? 'selected' : ''}>fries</option>
              <option value="extraChicken" ${p.stockUnit === 'extraChicken' ? 'selected' : ''}>chicken</option>
              <option value="sauceUpgrade" ${p.stockUnit === 'sauceUpgrade' ? 'selected' : ''}>sauce</option>
            </select>
          </label>
        </div>
        <div class="seg__row seg__row--3">
          <label class="seg__field">Price effect
            <select data-f="priceKind">
              <option value="none" ${priceKind === 'none' ? 'selected' : ''}>full price</option>
              <option value="off" ${priceKind === 'off' ? 'selected' : ''}>$ off</option>
              <option value="percentOff" ${priceKind === 'percentOff' ? 'selected' : ''}>% off</option>
              <option value="free" ${priceKind === 'free' ? 'selected' : ''}>free combo</option>
            </select>
          </label>
          <label class="seg__field">Amount
            <input data-f="priceVal" type="number" min="1" max="99" step="1" value="${priceVal}" placeholder="2" ${priceKind === 'none' || priceKind === 'free' ? 'disabled' : ''} />
          </label>
          <label class="seg__field">Meaning (shown to customer)
            <input data-f="meaning" value="${escapeHtml(p.meaning)}" maxlength="80" />
          </label>
        </div>
      </div>
      <button class="seg__del" data-del="${p.id}" type="button" aria-label="Remove ${escapeHtml(p.id)}" ${this.#draft.length <= 2 ? 'disabled' : ''}>×</button>
    </article>`
  }

  #mysteryRow(p: MysteryPrizeDefinition, total: number): string {
    const pct = total > 0 ? ((p.weight / total) * 100).toFixed(1) : '0.0'
    const priceKind = p.priceEffect.kind
    const priceVal =
      priceKind === 'off' ? (p.priceEffect as { amount: number }).amount
      : priceKind === 'percentOff' ? (p.priceEffect as { percent: number }).percent
      : ''
    return `
    <article class="seg" data-seg="${p.id}">
      <span class="seg__dot" style="background:linear-gradient(135deg,#F6C344,#FF4F7B)"></span>
      <div class="seg__main">
        <div class="seg__row">
          <label class="seg__field seg__field--grow">Box text
            <input data-f="sectorLabel" value="${escapeHtml(p.sectorLabel)}" maxlength="14" />
          </label>
          <label class="seg__field seg__field--grow">Prize name
            <input data-f="label" value="${escapeHtml(p.label)}" maxlength="40" />
          </label>
        </div>
        <div class="seg__row">
          <label class="seg__field seg__field--chance">Chance % (weight)
            <span class="seg__chancewrap">
              <input data-f="weight" type="range" min="1" max="60" step="1" value="${p.weight}" aria-label="Chance for ${escapeHtml(p.id)}" />
              <input data-f="weightNum" type="number" min="1" max="80" step="1" value="${p.weight}" class="seg__num" />
            </span>
            <span class="seg__pct">≈ ${pct}% of mystery opens</span>
          </label>
          <label class="seg__field seg__field--check">Bonus spin?
            <input data-f="bonus" type="checkbox" ${p.grantsBonusSpin ? 'checked' : ''} />
          </label>
        </div>
        <div class="seg__row seg__row--3">
          <label class="seg__field">Price effect
            <select data-f="priceKind">
              <option value="none" ${priceKind === 'none' ? 'selected' : ''}>full price</option>
              <option value="off" ${priceKind === 'off' ? 'selected' : ''}>$ off</option>
              <option value="percentOff" ${priceKind === 'percentOff' ? 'selected' : ''}>% off</option>
              <option value="free" ${priceKind === 'free' ? 'selected' : ''}>free combo</option>
            </select>
          </label>
          <label class="seg__field">Amount
            <input data-f="priceVal" type="number" min="1" max="99" step="1" value="${priceVal}" ${priceKind === 'none' || priceKind === 'free' ? 'disabled' : ''} />
          </label>
          <label class="seg__field">Meaning
            <input data-f="meaning" value="${escapeHtml(p.meaning)}" maxlength="80" />
          </label>
        </div>
      </div>
      <button class="seg__del" data-del="${p.id}" type="button" aria-label="Remove ${escapeHtml(p.id)}" ${this.#mysteryDraft.length <= 2 ? 'disabled' : ''}>×</button>
    </article>`
  }

  /* ---------------------------------------------------------------- wiring --- */

  /** Total of the currently visible tab — drives the Auto-balance button. */
  #tabTotal(): number {
    const list = this.#tab === 'main' ? this.#draft : this.#mysteryDraft
    return list.reduce((a, p) => a + (Number(p.weight) || 0), 0)
  }

  #wire(): void {
    const root = this.#root

    // Every closer: the scrim AND the × button both carry data-act=close.
    root.querySelectorAll('[data-act="close"]').forEach((b) => {
      b.addEventListener('click', () => {
        this.close()
        this.#hooks.onClose()
      })
    })

    root.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        this.#tab = (b as HTMLElement).dataset.tab as 'main' | 'mystery'
        this.render()
      })
    })

    // Per-row field edits — delegated, updates the draft then re-renders totals only.
    root.querySelectorAll('.seg').forEach((card) => {
      const id = (card as HTMLElement).dataset.seg!
      card.querySelectorAll('input, select').forEach((input) => {
        input.addEventListener('input', (e) => this.#applyField(id, e.target as HTMLInputElement))
        input.addEventListener('change', (e) => this.#applyField(id, e.target as HTMLInputElement))
      })
    })

    root.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.del!
        if (this.#tab === 'main') {
          if (this.#draft.length <= 2) return
          this.#draft = this.#draft.filter((p) => p.id !== id)
          normalizeWeights(this.#draft)
          this.#hooks.notify('Segment removed — rest rebalanced to 100%', 'info')
        } else {
          if (this.#mysteryDraft.length <= 2) return
          this.#mysteryDraft = this.#mysteryDraft.filter((p) => p.id !== id)
          normalizeWeights(this.#mysteryDraft)
          this.#hooks.notify('Mystery prize removed — rest rebalanced to 100%', 'info')
        }
        this.render()
      })
    })

    root.querySelector('[data-act="add"]')?.addEventListener('click', () => this.#addSegment())
    root.querySelector('[data-act="balance"]')?.addEventListener('click', () => {
      if (this.#tab === 'main') normalizeWeights(this.#draft)
      else normalizeWeights(this.#mysteryDraft)
      this.#hooks.notify('Rebalanced to exactly 100% — relative odds kept', 'good')
      this.render()
    })
    root.querySelector('[data-act="save"]')?.addEventListener('click', () => this.#save())
    root.querySelector('[data-act="reset"]')?.addEventListener('click', () => this.#reset())
    root.querySelector('[data-act="export"]')?.addEventListener('click', () => this.#export())
    root.querySelector('[data-act="import"]')?.addEventListener('click', () => {
      root.querySelector<HTMLInputElement>('[data-file="import"]')?.click()
    })
    root.querySelector<HTMLInputElement>('[data-file="import"]')?.addEventListener('change', (e) => {
      void this.#import((e.target as HTMLInputElement).files?.[0])
    })
  }

  #applyField(id: string, input: HTMLInputElement | HTMLSelectElement): void {
    const f = (input as HTMLElement).dataset.f
    if (!f) return
    const isMain = this.#tab === 'main'
    const list = (isMain ? this.#draft : this.#mysteryDraft) as Array<PrizeDefinition & MysteryPrizeDefinition>
    const prize = list.find((p) => p.id === id)
    if (!prize) return
    const val = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value

    switch (f) {
      case 'sectorLabel':
        prize.sectorLabel = String(val).toUpperCase().slice(0, 14)
        break
      case 'label':
        prize.label = String(val).slice(0, 40)
        break
      case 'meaning':
        prize.meaning = String(val).slice(0, 80)
        break
      case 'weight':
      case 'weightNum': {
        const n = Math.round(Number(val))
        prize.weight = Number.isFinite(n) ? Math.max(1, Math.min(80, n)) : prize.weight
        break
      }
      case 'fill':
      case 'icon':
      case 'tier':
        ;(prize as unknown as Record<string, unknown>)[f] = val
        break
      case 'stockUnit':
        if (!val) {
          delete (prize as unknown as Record<string, unknown>).stockUnit
          delete (prize as unknown as Record<string, unknown>).stockAmount
        } else {
          ;(prize as unknown as Record<string, unknown>).stockUnit = val
          ;(prize as unknown as Record<string, unknown>).stockAmount = (prize.stockAmount as number) || 1
        }
        break
      case 'priceKind': {
        const kind = String(val)
        if (kind === 'none') prize.priceEffect = { kind: 'none' }
        else if (kind === 'free') prize.priceEffect = { kind: 'free' }
        else if (kind === 'off') prize.priceEffect = { kind: 'off', amount: 2 }
        else if (kind === 'percentOff') prize.priceEffect = { kind: 'percentOff', percent: 50 }
        break
      }
      case 'priceVal': {
        const n = Number(val)
        if (prize.priceEffect.kind === 'off' && Number.isFinite(n)) prize.priceEffect.amount = Math.max(1, Math.min(99, Math.round(n)))
        if (prize.priceEffect.kind === 'percentOff' && Number.isFinite(n))
          prize.priceEffect.percent = Math.max(1, Math.min(99, Math.round(n)))
        break
      }
      case 'bonus':
        ;(prize as MysteryPrizeDefinition).grantsBonusSpin = Boolean(val) || undefined
        if (!(prize as MysteryPrizeDefinition).grantsBonusSpin) delete (prize as MysteryPrizeDefinition).grantsBonusSpin
        break
    }
    // Slider <-> number stay in sync without a full re-render (keeps focus).
    const card = this.#root.querySelector(`[data-seg="${CSS.escape(id)}"]`)
    if (card && (f === 'weight' || f === 'weightNum')) {
      const slider = card.querySelector<HTMLInputElement>('input[data-f="weight"]')
      const num = card.querySelector<HTMLInputElement>('input[data-f="weightNum"]')
      if (slider && document.activeElement !== slider) slider.value = String(prize.weight)
      if (num && document.activeElement !== num) num.value = String(prize.weight)
      this.#refreshTotals()
    } else if (f === 'priceKind') {
      this.render()
    }
  }

  #refreshTotals(): void {
    const mainSum = this.#draft.reduce((a, p) => a + (Number(p.weight) || 0), 0)
    const mysterySum = this.#mysteryDraft.reduce((a, p) => a + (Number(p.weight) || 0), 0)
    const sum = this.#tab === 'main' ? mainSum : mysterySum
    const bar = this.#root.querySelector('.settings__totalfill')
    const txt = this.#root.querySelector('.settings__totaltext')
    if (bar) {
      bar.setAttribute('style', `width:${Math.min(100, sum)}%`)
      bar.classList.toggle('is-ok', sum === 100)
      bar.classList.toggle('is-bad', sum !== 100)
    }
    if (txt) txt.textContent = `${sum}% / 100%`
    // Keep every row's ≈% label live as sliders move — stale odds are lies.
    const list = this.#tab === 'main' ? this.#draft : this.#mysteryDraft
    const suffix = this.#tab === 'main' ? 'of spins' : 'of mystery opens'
    this.#root.querySelectorAll('.seg').forEach((card, i) => {
      const prize = list[i]
      const pct = card.querySelector('.seg__pct')
      if (prize && pct) {
        const share = sum > 0 ? ((Number(prize.weight) || 0) / sum) * 100 : 0
        pct.textContent = `≈ ${share.toFixed(1)}% ${suffix}`
      }
    })
    // Re-validate everything live: save gate, auto-balance availability, and the
    // error/ok banner — a stale banner next to a live total bar reads as broken.
    const issues = validatePrizeList(this.#draft, this.#mysteryDraft)
    const errors = issues.filter((i) => i.level === 'error')
    const save = this.#root.querySelector<HTMLButtonElement>('[data-act="save"]')
    if (save) save.disabled = errors.length > 0
    const balance = this.#root.querySelector<HTMLButtonElement>('[data-act="balance"]')
    if (balance) balance.disabled = sum === 100
    const oldBanner = this.#root.querySelector('.settings__errors, .settings__ok')
    if (oldBanner) {
      const fresh = document.createElement('div')
      fresh.innerHTML =
        errors.length > 0
          ? `<ul class="settings__errors">${errors
              .slice(0, 6)
              .map((e) => `<li>✕ ${e.message}</li>`)
              .join('')}${errors.length > 6 ? `<li>… +${errors.length - 6} more</li>` : ''}</ul>`
          : `<p class="settings__ok">✓ Valid — every segment lands exactly as often as its % shows.</p>`
      oldBanner.replaceWith(...Array.from(fresh.childNodes))
    }
  }

  #addSegment(): void {
    if (this.#tab === 'main') {
      if (this.#draft.length >= 12) {
        this.#hooks.notify('Maximum 12 segments', 'bad')
        return
      }
      const n = this.#draft.length + 1
      const label = `Prize ${n}`
      const id = `${slugify(label, 'prize')}-${uid().slice(-4)}`
      this.#draft.push({
        id,
        sectorLabel: `PRIZE ${n}`,
        label,
        meaning: 'Staff-defined prize — edit me',
        tier: 'COMMON',
        weight: 5,
        icon: 'ticket',
        fill: 'cream',
        priceEffect: { kind: 'none' },
        sfx: 'win-pop',
      })
      normalizeWeights(this.#draft)
      this.#hooks.notify('Segment added — odds rebalanced to 100%', 'good')
    } else {
      if (this.#mysteryDraft.length >= 8) {
        this.#hooks.notify('Maximum 8 mystery prizes', 'bad')
        return
      }
      const n = this.#mysteryDraft.length + 1
      const id = `mystery-custom-${uid().slice(-4)}`
      this.#mysteryDraft.push({
        id,
        sectorLabel: `BONUS ${n}`,
        label: `Mystery prize ${n}`,
        meaning: 'Staff-defined mystery prize',
        weight: 10,
        priceEffect: { kind: 'none' },
        sfx: 'win-pop',
      })
      normalizeWeights(this.#mysteryDraft)
      this.#hooks.notify('Mystery prize added — odds rebalanced to 100%', 'good')
    }
    this.render()
  }

  #save(): void {
    const issues = validatePrizeList(this.#draft, this.#mysteryDraft)
    const errors = issues.filter((i) => i.level === 'error')
    if (errors.length) {
      this.#hooks.notify(errors[0]!.message, 'bad')
      this.render()
      return
    }
    this.#store.setPrizes(this.#draft, this.#mysteryDraft)
    this.#hooks.notify('Wheel saved — layout updated', 'good')
    this.#hooks.onSave()
    this.render()
  }

  #reset(): void {
    if (!window.confirm('Reset the wheel to the shipped defaults? This clears your custom segments.')) return
    this.#store.resetPrizes()
    this.#draft = this.#store.getPrizes()
    this.#mysteryDraft = this.#store.getMysteryPrizes()
    this.#hooks.notify('Wheel reset to defaults', 'good')
    this.#hooks.onSave()
    this.render()
  }

  #export(): void {
    const blob = new Blob([this.#store.exportPrizes()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `miguels-wheel-config-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 800)
  }

  async #import(file?: File | null): Promise<void> {
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as { prizes?: PrizeDefinition[]; mysteryPrizes?: MysteryPrizeDefinition[] }
      const prizes = data.prizes ?? []
      const mystery = data.mysteryPrizes ?? this.#mysteryDraft
      const issues = validatePrizeList(prizes as PrizeDefinition[], mystery as MysteryPrizeDefinition[])
      const errors = issues.filter((i) => i.level === 'error')
      if (errors.length) {
        this.#hooks.notify(`Import rejected: ${errors[0]!.message}`, 'bad')
        return
      }
      this.#draft = prizes as PrizeDefinition[]
      this.#mysteryDraft = mystery as MysteryPrizeDefinition[]
      this.render()
      this.#hooks.notify('Import loaded — press Save wheel to apply', 'info')
    } catch {
      this.#hooks.notify('Import failed — not valid JSON', 'bad')
    }
  }
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
