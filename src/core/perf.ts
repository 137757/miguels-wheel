/**
 * Frame-rate watchdog.
 *
 * The target is an ordinary school laptop driving a 1080p display, and we cannot
 * assume it will be fast. If the real frame rate sits below a usable threshold
 * for a sustained period, decorative atmosphere is shed so the wheel, the
 * reveals and all the audio keep running smoothly. Functionality is never
 * sacrificed for decoration — that is the whole point of the ordering.
 */

const SAMPLE_MS = 1000
const WINDOW_SAMPLES = 4
const MIN_FPS = 42
const GRACE_MS = 6000

export class PerfGuard {
  #frames = 0
  #lastSample = 0
  #samples: number[] = []
  #armedAt = 0
  #enabled = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  #tripped = false
  #raf = 0
  #listeners = new Set<(lite: boolean) => void>()

  constructor() {
    this.#armedAt = performance.now()
  }

  get isLite(): boolean {
    return this.#tripped
  }

  onChange(fn: (lite: boolean) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  start(): void {
    if (!this.#enabled || this.#tripped) return
    this.#lastSample = performance.now()
    const tick = (now: number) => {
      this.#frames += 1
      if (now - this.#lastSample >= SAMPLE_MS) {
        const fps = (this.#frames * 1000) / (now - this.#lastSample)
        this.#frames = 0
        this.#lastSample = now
        this.#samples.push(fps)
        if (this.#samples.length > WINDOW_SAMPLES) this.#samples.shift()
        this.#evaluate(now)
      }
      this.#raf = requestAnimationFrame(tick)
    }
    this.#raf = requestAnimationFrame(tick)
  }

  #evaluate(now: number): void {
    // Never trip during the opening moments: font decode, texture decode and
    // the first paint of a large SVG are all genuinely slow and transient.
    if (now - this.#armedAt < GRACE_MS) return
    if (this.#samples.length < WINDOW_SAMPLES) return

    const median = [...this.#samples].sort((a, b) => a - b)[Math.floor(WINDOW_SAMPLES / 2)]!
    if (median < MIN_FPS) {
      this.#trip()
      return
    }
    // Recovered comfortably: allow the atmosphere back.
    if (median > MIN_FPS + 14 && this.#tripped) this.#untrip()
  }

  #trip(): void {
    if (this.#tripped) return
    this.#tripped = true
    document.body.classList.add('perf-lite')
    for (const fn of this.#listeners) fn(true)
  }

  #untrip(): void {
    if (!this.#tripped) return
    this.#tripped = false
    document.body.classList.remove('perf-lite')
    for (const fn of this.#listeners) fn(false)
  }

  stop(): void {
    cancelAnimationFrame(this.#raf)
  }
}
