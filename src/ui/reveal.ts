/**
 * Result reveals.
 *
 * The tier structure is the whole point. A free drink and a free combo must not
 * get the same treatment, or the rarity stops meaning anything. Each reveal
 * returns a promise that resolves once the screen has *settled* — not when the
 * animation starts — so redemption cannot race the animation.
 */

import gsap from 'gsap'
import { animationTiming, colours } from '../config/eventConfig.ts'
import { applyPriceEffect, comboPriceCents, formatPrice, type InventoryState } from '../core/prizes.ts'
import type { PrizeDefinition } from '../config/eventConfig.ts'
import {
  commonDrink,
  commonFries,
  commonSauce,
  goldBurst,
  jackpot as jackpotConfetti,
  midCash,
  midChicken,
  rareHalf,
} from '../anim/celebration.ts'
import { icon, mascotSvg, type IconName } from './icons.ts'

export interface RevealRefs {
  root: HTMLElement
  scrim: HTMLElement
  stage: HTMLElement
}

export interface RevealOutcome {
  headline: string
  meaning: string
  iconName: IconName | null
  finalPriceCents: number
  /** Extra headline line for a discount prize, e.g. "-$2". */
  slamText?: string
}

export class Revealer {
  #refs: RevealRefs
  #reduced: boolean
  #tl: gsap.core.Timeline | null = null

  constructor(refs: RevealRefs, reduced: boolean) {
    this.#refs = refs
    this.#reduced = reduced
  }

  get busy(): boolean {
    return this.#tl !== null && this.#tl.isActive()
  }

  #teardown(): void {
    this.#tl?.kill()
    this.#tl = null
    this.#refs.stage.innerHTML = ''
    this.#refs.scrim.style.opacity = '0'
  }

  /**
   * Make the overlay visible.
   *
   * The root ships with the `hidden` attribute so the stage is clean before the
   * first win; every reveal must therefore un-hide it explicitly.
   */
  #present(): void {
    this.#refs.root.hidden = false
  }

  /**
   * Show a prize. Resolves when the screen has settled and the customer has had
   * time to read the price.
   */
  async show(prize: PrizeDefinition, inv: InventoryState): Promise<void> {
    this.#teardown()
    this.#present()
    // The root carries the tier so the scrim can be tinted per rarity.
    this.#refs.root.className = `reveal is-${prize.tier.toLowerCase()}`
    const t = animationTiming
    const tOut: Record<string, number> = {
      common: t.common.hold,
      mid: t.mid.hold,
      special: 0.4,
      rare: t.rare.hold,
      jackpot: t.jackpot.hold,
    }

    switch (prize.tier) {
      case 'JACKPOT':
        await this.#jackpot()
        break
      case 'RARE':
        await this.#rareHalf(prize)
        break
      case 'SPECIAL':
        await this.#mysteryLanding(prize)
        break
      case 'MID':
        await this.#mid(prize)
        break
      case 'COMMON':
      default:
        await this.#common(prize, inv)
        break
    }

    await this.#hold(tOut[prize.tier] ?? 0.6)
  }

  #hold(seconds: number): Promise<void> {
    if (this.#reduced) return new Promise((r) => setTimeout(r, Math.max(600, seconds * 1000)))
    return new Promise((r) => setTimeout(r, Math.max(700, seconds * 1000)))
  }

  /* --------------------------------------------------------------- shared --- */

  #buildCard(o: RevealOutcome, tier: string): HTMLElement {
    const el = document.createElement('div')
    el.className = `prize prize--${tier.toLowerCase()}`
    const payLabel = o.finalPriceCents === 0 ? 'PAY' : 'PAY'
    el.innerHTML = `
      ${o.slamText ? `<div class="slam" data-fx="slam">${o.slamText}</div>` : ''}
      <div class="prize__icon" data-fx="icon">${o.iconName ? icon(o.iconName) : ''}</div>
      <p class="prize__kicker" data-fx="kicker">YOU WON</p>
      <h2 class="prize__headline" data-fx="head">${o.headline}</h2>
      <p class="prize__meaning" data-fx="meaning">${o.meaning}</p>
      <div class="prize__pay ${o.finalPriceCents === 0 ? 'prize__pay--free' : ''}" data-fx="pay">
        <span class="prize__payLabel">${payLabel}</span>
        <span class="prize__payAmount">${formatPrice(o.finalPriceCents)}</span>
      </div>
      <p class="prize__hint" data-fx="hint">tell the counter your prize</p>
    `
    this.#refs.stage.appendChild(el)
    return el
  }

  #scrimIn(delay = 0): void {
    gsap.to(this.#refs.scrim, { opacity: 1, duration: this.#reduced ? 0.01 : 0.32, delay, ease: 'power2.out' })
  }

  /* --------------------------------------------------------------- COMMON --- */

  async #common(prize: PrizeDefinition, _inv: InventoryState): Promise<void> {
    const outcome: RevealOutcome = {
      headline: prize.sectorLabel,
      meaning: prize.meaning,
      iconName: prize.icon as IconName,
      finalPriceCents: applyPriceEffect(comboPriceCents, prize.priceEffect),
    }
    const el = this.#buildCard(outcome, prize.tier)
    this.#scrimIn()

    if (prize.id === 'sauce-upgrade') commonSauce()
    else if (prize.id === 'free-drink') commonDrink()
    else commonFries()

    this.#tl = gsap.timeline()
    this.#tl.fromTo(
      el,
      { scale: 0.9, opacity: 0 },
      { scale: 1, opacity: 1, duration: this.#d(animationTiming.common.pop), ease: 'back.out(2.2)' },
    )
    const head = el.querySelector('[data-fx="head"]')
    if (head) this.#tl.fromTo(head, { y: 26 }, { y: 0, duration: this.#d(0.3), ease: 'power3.out' }, '<')
    const pay = el.querySelector('[data-fx="pay"]')
    if (pay) this.#tl.fromTo(pay, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: this.#d(0.34), ease: 'back.out(2.6)' }, '-=0.1')
    this.#fadeInRest(el, 0.05)
  }

  /* ------------------------------------------------------------------ MID --- */

  async #mid(prize: PrizeDefinition): Promise<void> {
    const isCash = prize.priceEffect.kind === 'off' || prize.priceEffect.kind === 'percentOff'
    const slamText =
      prize.priceEffect.kind === 'off'
        ? `-$${prize.priceEffect.amount}`
        : prize.priceEffect.kind === 'percentOff'
          ? `-${prize.priceEffect.percent}%`
          : undefined
    const outcome: RevealOutcome = {
      headline: prize.sectorLabel,
      meaning: prize.meaning,
      iconName: null,
      finalPriceCents: applyPriceEffect(comboPriceCents, prize.priceEffect),
      slamText,
    }
    const el = this.#buildCard(outcome, prize.tier)
    this.#scrimIn()

    if (isCash) {
      midCash()
      const slam = el.querySelector('[data-fx="slam"]')
      if (slam && !this.#reduced) {
        this.#tl = gsap.timeline()
        this.#tl.fromTo(slam, { scale: 3.4, opacity: 0, rotate: -9 }, { scale: 1, opacity: 1, duration: 0.24, ease: 'power4.in' })
        this.#tl.fromTo(slam, { rotate: -9 }, { rotate: 0, duration: 0.22, ease: 'elastic.out(1.4,0.4)' })
        this.#tl.fromTo(
          [slam, el.querySelector('[data-fx="pay"]')],
          { scale: 0.6, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' },
          '-=0.08',
        )
      }
    } else {
      midChicken()
      this.#tl = gsap.timeline()
      this.#tl.fromTo(el, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: this.#d(0.3), ease: 'back.out(1.9)' })
      const iconEl = el.querySelector('[data-fx="icon"]')
      if (iconEl) this.#tl.fromTo(iconEl, { rotate: -18, scale: 0.4 }, { rotate: 0, scale: 1, duration: 0.4, ease: 'back.out(2.4)' }, '-=0.2')
    }
    this.#fadeInRest(el, 0.06)
  }

  /* ----------------------------------------------------------------- RARE --- */

  async #rareHalf(prize: PrizeDefinition): Promise<void> {
    // 1 — red wipe across the whole screen.
    const wipe = document.createElement('div')
    wipe.style.cssText = `position:fixed;inset:0;z-index:44;background:${colours.red};opacity:0;pointer-events:none`
    document.body.appendChild(wipe)
    gsap.to(wipe, {
      opacity: 0.92,
      duration: this.#d(0.18),
      ease: 'power2.in',
      onComplete: () => {
        gsap.to(wipe, { opacity: 0, duration: 0.42, delay: 0.12, ease: 'power2.out' })
      },
    })

    const bigText =
      prize.priceEffect.kind === 'percentOff'
        ? `${prize.priceEffect.percent}% OFF`
        : prize.priceEffect.kind === 'off'
          ? `$${prize.priceEffect.amount} OFF`
          : prize.sectorLabel
    const outcome: RevealOutcome = {
      headline: bigText,
      meaning: prize.meaning,
      iconName: null,
      finalPriceCents: applyPriceEffect(comboPriceCents, prize.priceEffect),
    }
    const el = this.#buildCard(outcome, prize.tier)
    this.#scrimIn(0.1)
    rareHalf()

    // 2 — the stamp.
    const stamp = document.createElement('div')
    stamp.className = 'halfprice'
    stamp.innerHTML = `
      <div class="halfprice__stamp">
        <span class="halfprice__big">${bigText}</span>
        <span class="halfprice__sub">${prize.tier} WINNER</span>
      </div>`
    // Body-level, not #refs.root: .reveal is z-index 40, so it forms a stacking
    // context and the stamp's own z-index 45 could never beat the body-level red
    // wipe at z-index 44 that paints above it. The stamp rendered fully opaque and
    // measurable but was invisible — the 50% OFF beat showed a blank red field.
    document.body.appendChild(stamp)

    this.#tl = gsap.timeline({
      onComplete: () => {
        stamp.remove()
      },
    })
    if (this.#reduced) {
      this.#tl.set(stamp, { opacity: 1 })
    } else {
      this.#tl
        .fromTo(stamp, { opacity: 0 }, { opacity: 1, duration: 0.1 })
        .fromTo(
          stamp.querySelector('.halfprice__stamp'),
          { scale: 2.6, opacity: 0, rotate: -18 },
          { scale: 1, opacity: 1, rotate: -7, duration: this.#d(0.24), ease: 'power4.in' },
          '<',
        )
        .to(stamp.querySelector('.halfprice__stamp'), {
          scale: 0.96,
          duration: 0.07,
          ease: 'power2.out',
          yoyo: true,
          repeat: 1,
        })
        // 3 — one controlled screen shake, then the price.
        .fromTo(
          this.#refs.root,
          { x: 0 },
          {
            x: 14,
            duration: 0.045,
            repeat: 5,
            yoyo: true,
            ease: 'none',
            onComplete: () => gsap.set(this.#refs.root, { x: 0 }),
          },
          '-=0.15',
        )
        .to(stamp, { opacity: 0, duration: 0.28, ease: 'power2.in' }, '-=0.05')
        .fromTo(
          el,
          { opacity: 0, y: 30 },
          { opacity: 1, y: 0, duration: this.#d(0.36), ease: 'power3.out' },
          '-=0.2',
        )
    }
    this.#fadeInRest(el, 0.12)
  }

  /* -------------------------------------------------------------- MYSTERY --- */

  /** Brief landing when the wheel itself stops on Mystery; the box runs separately. */
  async #mysteryLanding(prize: PrizeDefinition): Promise<void> {
    const outcome: RevealOutcome = {
      headline: 'MYSTERY BOX',
      meaning: 'Opening it now…',
      iconName: 'gift',
      finalPriceCents: applyPriceEffect(comboPriceCents, prize.priceEffect),
    }
    const el = this.#buildCard(outcome, prize.tier)
    this.#scrimIn()
    this.#tl = gsap.timeline()
    this.#tl.fromTo(el, { scale: 0.7, opacity: 0, rotate: -6 }, { scale: 1, opacity: 1, rotate: 0, duration: this.#d(0.4), ease: 'back.out(1.8)' })
    this.#fadeInRest(el, 0.08)
  }

  /* -------------------------------------------------------------- JACKPOT --- */

  async #jackpot(): Promise<void> {
    const layer = document.createElement('div')
    layer.className = 'jackpot-layer'
    layer.innerHTML = `
      <div class="jackpot-layer__dark" data-fx="dark"></div>
      <div class="jackpot-layer__wash" data-fx="wash"></div>
      <div class="jackpot-layer__rays" data-fx="rays"></div>
      <div class="jackpot-layer__crown" data-fx="crown">
        ${icon('crown', '')}
      </div>
      <div class="jackpot-layer__word">
        <span class="jackpot-layer__jackpot" data-fx="jackpot">JACKPOT</span>
        <span class="jackpot-layer__free" data-fx="free">FREE COMBO</span>
      </div>
      <div class="jackpot-layer__mascot" data-fx="mascot">${mascotSvg('cheer')}</div>
    `
    this.#refs.root.appendChild(layer)

    const q = <T extends Element>(name: string) => layer.querySelector<T>(`[data-fx="${name}"]`)!

    // A single bright impact flash. Never a strobe.
    const flash = document.createElement('div')
    flash.className = 'impact-flash'
    document.body.appendChild(flash)
    gsap.fromTo(
      flash,
      { opacity: 0 },
      { opacity: 0.82, duration: 0.06, yoyo: true, repeat: 1, ease: 'power2.out', onComplete: () => flash.remove() },
    )

    const t = animationTiming.jackpot
    const rect = this.#refs.root.getBoundingClientRect()
    const origin = { x: 0.5, y: 0.42 }

    this.#tl = gsap.timeline()
    if (this.#reduced) {
      gsap.set([q('dark'), q('wash'), q('crown'), q('jackpot'), q('free'), q('mascot')], { opacity: 1 })
      jackpotConfetti()
      this.#tl.to({}, { duration: t.hold })
    } else {
      this.#tl
        // 1 — 150ms of darkness.
        .fromTo(q('dark'), { opacity: 0 }, { opacity: 0.55, duration: this.#d(t.darkness), ease: 'power2.in' })
        // 2 — gold radial burst from the centre, then the wash floods the screen.
        .add(() => goldBurst(origin), '-=0.02')
        .fromTo(q('rays'), { opacity: 0, scale: 0.72, rotate: -18 }, { opacity: 1, scale: 1, rotate: 0, duration: this.#d(t.burst), ease: 'power3.out' }, '<')
        .fromTo(q('wash'), { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: this.#d(t.burst * 1.3), ease: 'power3.out' }, '<')
        // 3 — the crown drops in.
        .fromTo(
          q('crown'),
          { opacity: 0, y: -420, scale: 1.5, rotate: -22 },
          { opacity: 1, y: 0, scale: 1, rotate: 0, duration: this.#d(t.crownDrop), ease: 'bounce.out' },
          '-=0.1',
        )
        // 4 — JACKPOT, then the giant words.
        .fromTo(q('jackpot'), { opacity: 0, scale: 1.9, letterSpacing: '1.2em' }, { opacity: 1, scale: 1, letterSpacing: '0.3em', duration: this.#d(t.textIn), ease: 'power4.out' }, '-=0.28')
        .fromTo(q('free'), { opacity: 0, scale: 2.6 }, { opacity: 1, scale: 1, duration: this.#d(0.5), ease: 'power4.out' }, '-=0.34')
        // 5 — the sustained gold/red/cream confetti.
        .add(() => jackpotConfetti(), '-=0.3')
        // 6 — mascot celebration.
        .fromTo(q('mascot'), { opacity: 0, x: 180, rotate: 22 }, { opacity: 1, x: 0, rotate: -4, duration: 0.6, ease: 'back.out(1.7)' }, '-=0.5')
        .to({}, { duration: t.confettiSpread * 0.5 })
        .to(q('dark'), { opacity: 0.16, duration: 0.3 })
    }

    await new Promise<void>((r) => {
      this.#tl!.eventCallback('onComplete', () => {
        this.#showJackpotPay(layer, rect)
        r()
      })
    })

    // Keep the final PAY $0 on screen until staff redeems. The wash only eases
    // back a little: dropping it far turned the price screen muddy brown, and
    // the $0 badge is gold-on-gold unless the field stays bright.
    //
    // These three compound. Each looked harmless alone, but together the wash
    // settled at 0.87 over a 0.34 dark layer and the screen measured as flat
    // brown (#905010) rather than gold — the exact muddiness this comment
    // claims to be avoiding. The takeover is at wash 1.0 / dark 0.16, so these
    // stay much closer to that.
    this.#refs.stage.innerHTML = ''
    gsap.set(layer.querySelector('[data-fx="dark"]'), { opacity: 0.2 })
    gsap.to(layer.querySelectorAll('.jackpot-layer__rays'), { opacity: 0.7, duration: 0.4 })
    gsap.to(layer.querySelector('[data-fx="wash"]'), { opacity: 0.95, duration: 0.4 })
  }

  #showJackpotPay(layer: HTMLElement, _rect: DOMRect): void {
    const pay = document.createElement('div')
    pay.className = 'prize'
    pay.innerHTML = `
      <div class="prize__pay prize__pay--free" data-fx="pay">
        <span class="prize__payLabel">PAY</span>
        <span class="prize__payAmount">$0</span>
      </div>
      <p class="prize__hint">tell the counter your prize</p>
    `
    layer.appendChild(pay)
    // Veil sits UNDER the words so JACKPOT / FREE COMBO stay vivid — it only
    // deepens the wash behind the PAY badge.
    const scrim = document.createElement('div')
    scrim.style.cssText = 'position:absolute;inset:0;background:rgba(28,12,2,.28)'
    const word = layer.querySelector('.jackpot-layer__word')
    if (word) layer.insertBefore(scrim, word)
    else layer.insertBefore(scrim, pay)
    gsap.fromTo(pay, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: this.#d(0.4), ease: 'back.out(2)' })
  }

  /* ---------------------------------------------------------------- misc --- */

  #fadeInRest(el: HTMLElement, stagger: number): void {
    const rest = [el.querySelector('[data-fx="kicker"]'), el.querySelector('[data-fx="meaning"]'), el.querySelector('[data-fx="pay"]'), el.querySelector('[data-fx="hint"]')].filter(Boolean)
    this.#tl?.fromTo(rest, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: this.#d(0.28), stagger, ease: 'power3.out' }, '-=0.05')
  }

  /** Reduced motion collapses durations but never removes the outcome. */
  #d(seconds: number): number {
    return this.#reduced ? 0.01 : seconds
  }

  close(): void {
    this.#teardown()
    this.#refs.root.hidden = true
    document.querySelectorAll('.jackpot-layer, .halfprice, .impact-flash').forEach((n) => n.remove())
  }
}
