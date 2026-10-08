/**
 * Idle atmosphere.
 *
 * The screen has to keep pulling people over between customers, but it must not
 * be noisy — the loudest moment of the day has to be the jackpot, and you cannot
 * do that if something is always shouting. So: slow loops, no soundtrack, and
 * exactly ONE promotional line on screen at a time.
 */

import gsap from 'gsap'
import { promoRotateMs, promotionalMessages } from '../config/eventConfig.ts'
import { mascotSvg, type MascotPose } from './icons.ts'

export class Petals {
  #host: HTMLElement
  #count: number
  #timer = 0

  constructor(host: HTMLElement, count = 5) {
    this.#host = host
    this.#count = count
  }

  start(): void {
    this.stop()
    const n = this.#count
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span')
      p.className = 'petal'
      p.style.left = `${4 + Math.random() * 92}%`
      p.style.setProperty('--size', `${14 + Math.random() * 18}px`)
      p.style.setProperty('--dur', `${16 + Math.random() * 14}s`)
      p.style.setProperty('--delay', `${-(Math.random() * 26).toFixed(1)}s`)
      p.style.setProperty('--sway', `${(Math.random() * 22 - 6).toFixed(1)}vw`)
      this.#host.appendChild(p)
    }
  }

  stop(): void {
    clearTimeout(this.#timer)
    this.#host.replaceChildren()
  }
}

export class PromoRotator {
  #el: HTMLElement
  #index = 0
  #timer: ReturnType<typeof setTimeout> | null = null
  #reduced: boolean
  #messages: string[]

  constructor(el: HTMLElement, reduced: boolean) {
    this.#el = el
    this.#reduced = reduced
    this.#messages = [...promotionalMessages]
  }

  start(): void {
    this.stop()
    if (this.#messages.length === 0) return
    this.#el.textContent = this.#messages[this.#index] ?? ''
    if (this.#reduced) return
    const tick = () => {
      this.#el.classList.remove('is-in')
      this.#el.classList.add('is-out')
      setTimeout(() => {
        this.#index = (this.#index + 1) % this.#messages.length
        this.#el.textContent = this.#messages[this.#index] ?? ''
        this.#el.classList.remove('is-out')
        this.#el.classList.add('is-in')
        this.#timer = setTimeout(tick, promoRotateMs)
      }, 520)
    }
    this.#timer = setTimeout(tick, promoRotateMs)
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }
}

export class Mascot {
  #host: HTMLElement
  #blinker: ReturnType<typeof setInterval> | null = null
  #bob: gsap.core.Tween | null = null
  #pose: MascotPose = 'idle'
  #reduced: boolean

  constructor(host: HTMLElement, reduced: boolean) {
    this.#host = host
    this.#reduced = reduced
  }

  setPose(pose: MascotPose): void {
    if (pose === this.#pose) return
    this.#pose = pose
    this.#render()
  }

  #render(): void {
    this.#host.innerHTML = mascotSvg(this.#pose)
    this.#host.classList.toggle('is-pointing', this.#pose === 'point')
  }

  start(): void {
    this.#render()
    if (this.#reduced) return

    this.#bob = gsap.to(this.#host, {
      y: -9,
      duration: 1.9,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    })

    // Blink on an irregular human-ish cadence.
    this.#blinker = setInterval(() => {
      this.#host.classList.add('is-blinking')
      setTimeout(() => this.#host.classList.remove('is-blinking'), 130)
    }, 3600 + Math.random() * 3200)
  }

  stop(): void {
    this.#bob?.kill()
    this.#bob = null
    if (this.#blinker) clearInterval(this.#blinker)
    this.#blinker = null
  }

  /** A short celebratory hop, used on a win. */
  cheer(): void {
    if (this.#reduced) return
    gsap.fromTo(
      this.#host,
      { y: 0, rotate: 0 },
      { y: -26, rotate: -7, duration: 0.2, ease: 'power2.out', yoyo: true, repeat: 1, overwrite: false },
    )
  }
}
