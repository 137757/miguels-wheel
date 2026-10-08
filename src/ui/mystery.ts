/**
 * Mystery Box: the second-stage reveal.
 *
 * Enters, spotlights, shakes, pauses, bursts — then the sub-prize. The pause before
 * the burst is doing the same job as the post-spin silence: giving the crowd a beat
 * to lean in before the payoff.
 */

import gsap from 'gsap'
import { animationTiming, colours } from '../config/eventConfig.ts'
import { formatPrice } from '../core/prizes.ts'
import type { MysteryPrizeDefinition } from '../config/eventConfig.ts'
import { celebration } from '../anim/celebration.ts'
import type { AudioEngine } from '../audio/engine.ts'

export interface MysteryRefs {
  root: HTMLElement
  box: HTMLElement
  label: HTMLElement
}

export class MysteryBox {
  #refs: MysteryRefs
  #reduced: boolean
  #tl: gsap.core.Timeline | null = null

  constructor(refs: MysteryRefs, reduced: boolean) {
    this.#refs = refs
    this.#reduced = reduced
  }

  get busy(): boolean {
    return this.#tl !== null && this.#tl.isActive()
  }

  /**
   * Play the full sequence and resolve once the sub-prize is readable.
   * `payCents` is the price the customer ends up paying.
   */
  async run(prize: MysteryPrizeDefinition, payCents: number, audio: AudioEngine): Promise<void> {
    const t = animationTiming.mystery
    const { root, box, label } = this.#refs
    root.hidden = false

    const lid = box.querySelector<SVGGElement>('.mb-lid')
    const burst = box.querySelector<SVGGElement>('.mb-burst')
    const spot = root.querySelector<HTMLElement>('.mystery__spot')!
    const svgBox = box.querySelector<SVGGElement>('.mb-body')!

    label.textContent = prize.grantsBonusSpin ? 'MYSTERY BOX' : 'OPENING…'

    const d = (s: number) => (this.#reduced ? 0.01 : s)

    // Screen darkens, everything else ducks.
    gsap.set(root, { opacity: 1 })
    audio.duck(0.32, t.boxEnter + t.shakeDuration + t.pauseBeforeBurst + 1.2)

    audio.play('mystery-rumble', { volume: 0.5 })
    audio.play('mystery-suspense', { volume: 0.42, when: 0.18 })

    const tl = gsap.timeline()
    this.#tl = tl

    if (this.#reduced) {
      tl.set([box, spot], { opacity: 1 })
      tl.add(() => {
        burst?.setAttribute('opacity', '1')
      })
      tl.to({}, { duration: 0.3 })
    } else {
      // 1 — spotlight blooms, box enters.
      tl.fromTo(spot, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1.1, duration: d(t.boxEnter), ease: 'power2.out' }, 0)
        .fromTo(
          box,
          { opacity: 0, y: 220, scale: 0.72, rotate: -7 },
          { opacity: 1, y: 0, scale: 1, rotate: 0, duration: d(t.boxEnter), ease: 'power3.out' },
          0,
        )
        // 2 — shakes, accelerating, getting smaller as if struggling to open.
        .to(box, {
          x: 9,
          duration: 0.05,
          repeat: Math.round(t.shakeDuration / 0.1),
          yoyo: true,
          ease: 'none',
        })
        .to(box, { rotate: 0.9, duration: 0.05, repeat: Math.round(t.shakeDuration / 0.1), yoyo: true, ease: 'none' }, '<')
        .to(box, { scale: 1.03, duration: d(t.shakeDuration * 0.5), ease: 'sine.inOut' }, '<')
        .to(label, { opacity: 0, duration: 0.2 }, '<')
        // 3 — the pause. Everyone leans in.
        .to({}, { duration: d(t.pauseBeforeBurst) })
        // 4 — burst.
        .add(() => {
          audio.play('mystery-burst', { volume: 0.85 })
          audio.play('mystery-sparkle', { volume: 0.6, when: 0.05 })
          celebration.mysteryBurst()
        })
        .to(burst, { attr: { opacity: 1 }, scale: 1.3, duration: d(t.burst), ease: 'power3.out' }, '<')
        .to(lid, { y: -150, rotate: -26, opacity: 0.2, duration: d(t.burst), ease: 'power2.in' }, '<')
        .to(svgBox, { y: 14, duration: d(0.12), ease: 'power2.out' }, '<')
        .to(burst, { attr: { opacity: 0 }, duration: d(0.4), delay: 0.3, ease: 'power2.in' })
    }

    audio.unduck(0.1)

    // 5 — the sub-prize.
    tl.add(() => this.#showResult(prize, payCents))
    tl.add(() => audio.play(prize.sfx, { volume: 0.8 }))

    await new Promise<void>((resolve) => {
      tl.eventCallback('onComplete', () => resolve())
    })
  }

  #showResult(prize: MysteryPrizeDefinition, payCents: number): void {
    const el = document.createElement('div')
    el.className = 'mystery__result'
    const isBonus = Boolean(prize.grantsBonusSpin)
    el.innerHTML = `
      <span class="prize__kicker">MYSTERY BOX</span>
      <span class="mystery__resultHead">${prize.sectorLabel}</span>
      <span class="prize__meaning">${prize.meaning}</span>
      ${
        isBonus
          ? ''
          : `<span class="mystery__resultPay">
               <span class="prize__payLabel">PAY</span>
               <span class="mystery__resultPayAmount">${formatPrice(payCents)}</span>
             </span>`
      }
    `
    this.#refs.root.appendChild(el)
    this.#refs.box.style.opacity = '0'

    gsap.fromTo(
      el,
      { opacity: 0, scale: 0.6, y: 40 },
      { opacity: 1, scale: 1, y: 0, duration: this.#reduced ? 0.01 : 0.5, ease: 'back.out(1.8)' },
    )
    if (isBonus) {
      // An unmistakable "again!" for the bonus spin.
      gsap.fromTo(
        el.querySelector('.mystery__resultHead'),
        { rotate: -3, scale: 0.8 },
        { rotate: 0, scale: 1, duration: 0.6, ease: 'elastic.out(1.1, 0.5)' },
      )
    } else if (prize.id === 'mystery-friend-drink') {
      celebration.commonDrink()
    } else if (prize.id === 'mystery-two-chicken') {
      celebration.midChicken()
    } else {
      celebration.midCash()
    }
  }

  /** Clear the mystery layer and hand the screen back. */
  close(): void {
    this.#tl?.kill()
    this.#tl = null
    this.#refs.root.hidden = true
    this.#refs.root.style.opacity = ''
    this.#refs.root.querySelectorAll('.mystery__result').forEach((n) => n.remove())
    const box = this.#refs.box
    gsap.set(box, { clearProps: 'all' })
    box.style.opacity = ''
    box.querySelector<SVGGElement>('.mb-lid')?.removeAttribute('transform')
    box.querySelector<SVGGElement>('.mb-burst')?.setAttribute('opacity', '0')
    box.querySelector<SVGGElement>('.mb-lid')?.setAttribute('transform', '')
    box.querySelector<SVGGElement>('.mb-burst')?.removeAttribute('transform')
    const label = this.#refs.label
    gsap.set(label, { clearProps: 'all' })
  }

  get accent(): string {
    return colours.gold
  }
}
