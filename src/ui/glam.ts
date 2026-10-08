/**
 * Glam layer: gold-dust canvas, win glow, and jackpot spectacle helpers.
 *
 * Everything here is decorative — the draw, the wheel geometry and the audio
 * never depend on it. Respects `prefers-reduced-motion` and the PerfGuard
 * lite mode (canvas pauses, CSS glows stay but stop animating).
 */

import gsap from 'gsap'

interface Mote {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  tw: number
  twSpeed: number
  hue: number
  alpha: number
}

export class GlamField {
  #canvas: HTMLCanvasElement
  #ctx: CanvasRenderingContext2D | null = null
  #motes: Mote[] = []
  #raf = 0
  #running = false
  #reduced: boolean
  #burstQueue: Array<{ x: number; y: number; n: number; spread: number }> = []
  #w = 0
  #h = 0
  #lastFrame = 0
  /** Pre-rendered glow dots — drawImage is an order of magnitude cheaper than
   * arc()+shadowBlur per particle per frame (shadowBlur was the top cost). */
  #sprites: HTMLCanvasElement[] = []

  constructor(canvas: HTMLCanvasElement, reduced: boolean, count = 44) {
    this.#canvas = canvas
    this.#reduced = reduced
    this.#ctx = canvas.getContext('2d')
    this.#sprites = [this.#makeSprite('#FFE08A'), this.#makeSprite('#F6C344'), this.#makeSprite('#FFF6DA')]
    this.#resize()
    window.addEventListener('resize', () => this.#resize())
    this.#seed(count)
  }

  setReduced(v: boolean): void {
    this.#reduced = v
  }

  #makeSprite(color: string): HTMLCanvasElement {
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
    grad.addColorStop(0, '#FFFFFF')
    grad.addColorStop(0.25, color)
    grad.addColorStop(1, 'rgba(246,195,68,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 32, 32)
    return c
  }

  #resize(): void {
    // Half resolution, CSS-scaled up: soft glow dots hide the upscale
    // completely, while fill + texture-upload cost drops to a quarter.
    // (DPR 1 fullscreen canvas uploads were a top frame cost.)
    this.#w = Math.ceil(window.innerWidth / 2)
    this.#h = Math.ceil(window.innerHeight / 2)
    this.#canvas.width = this.#w
    this.#canvas.height = this.#h
  }

  #seed(count: number): void {
    this.#motes = Array.from({ length: count }, () => this.#mote(true))
  }

  #mote(anywhere = false): Mote {
    return {
      x: Math.random() * this.#w,
      y: anywhere ? Math.random() * this.#h : this.#h + 10,
      r: 0.8 + Math.random() * 2.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -0.12 - Math.random() * 0.4,
      tw: Math.random() * Math.PI * 2,
      twSpeed: 0.008 + Math.random() * 0.03,
      hue: 38 + Math.random() * 14,
      alpha: 0.25 + Math.random() * 0.55,
    }
  }

  start(): void {
    if (this.#running || !this.#ctx) return
    this.#running = true
    const loop = () => {
      if (!this.#running) return
      this.#tick()
      this.#raf = requestAnimationFrame(loop)
    }
    this.#raf = requestAnimationFrame(loop)
  }

  stop(): void {
    this.#running = false
    cancelAnimationFrame(this.#raf)
    this.#ctx?.clearRect(0, 0, this.#w, this.#h)
  }

  /** Celebration burst at normalised viewport coords (0..1). */
  burst(x = 0.5, y = 0.42, n = 60): void {
    if (this.#reduced) return
    this.#burstQueue.push({ x: x * this.#w, y: y * this.#h, n, spread: 5 })
    // Wake the field if perf-lite had paused it.
    if (!this.#running) this.start()
    // Auto-settle: extra motes rain out within a few seconds.
    setTimeout(() => this.#settle(), 2600)
  }

  jackpotRain(): void {
    if (this.#reduced) return
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.burst(0.2 + Math.random() * 0.6, 0.25, 70), i * 260)
    }
  }

  #settle(): void {
    if (this.#motes.length > 90) this.#motes = this.#motes.slice(0, 90)
  }

  #tick(): void {
    const ctx = this.#ctx
    if (!ctx) return
    // Cap at ~30fps: gold dust is ambient, nobody can see 60fps twinkle.
    const now = performance.now()
    if (now - this.#lastFrame < 33) return
    this.#lastFrame = now
    ctx.clearRect(0, 0, this.#w, this.#h)

    // Spawn queued bursts as fast golden sparks.
    for (const q of this.#burstQueue) {
      for (let i = 0; i < q.n; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = 1 + Math.random() * q.spread
        this.#motes.push({
          x: q.x,
          y: q.y,
          r: 1 + Math.random() * 2.8,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 1.2,
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.05 + Math.random() * 0.08,
          hue: 40 + Math.random() * 12,
          alpha: 0.7 + Math.random() * 0.3,
        })
      }
    }
    this.#burstQueue.length = 0

    for (const m of this.#motes) {
      m.tw += m.twSpeed
      m.x += m.vx
      m.y += m.vy
      m.vy += 0.008 // gentle gravity on sparks, float on dust
      if (m.y > this.#h + 12 || m.y < -14 || m.x < -12 || m.x > this.#w + 12) {
        Object.assign(m, this.#mote())
      }
      const twinkle = 0.55 + 0.45 * Math.sin(m.tw)
      const size = m.r * 4 * (0.7 + 0.3 * twinkle)
      ctx.globalAlpha = m.alpha * twinkle
      ctx.drawImage(this.#sprites[(m.hue | 0) % this.#sprites.length]!, m.x - size / 2, m.y - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }
}

/** Screen-wide gold flash + wheel glow pulse on a win. Never a strobe. */
export function winFlash(tier: 'COMMON' | 'MID' | 'SPECIAL' | 'RARE' | 'JACKPOT'): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const flash = document.createElement('div')
  flash.className = `glam-flash glam-flash--${tier.toLowerCase()}`
  document.body.appendChild(flash)
  const peak = tier === 'JACKPOT' ? 0.5 : tier === 'RARE' ? 0.34 : 0.2
  gsap.fromTo(
    flash,
    { opacity: 0 },
    { opacity: peak, duration: 0.09, yoyo: true, repeat: 1, ease: 'power2.out', onComplete: () => flash.remove() },
  )

  // Wheel glow punch.
  const mount = document.getElementById('wheelMount')
  if (mount) {
    gsap.fromTo(
      mount,
      { filter: 'brightness(1)' },
      {
        filter: 'brightness(1.35) saturate(1.25)',
        duration: 0.22,
        yoyo: true,
        repeat: tier === 'JACKPOT' ? 3 : 1,
        ease: 'sine.inOut',
        clearProps: 'filter',
      },
    )
  }
}

/** Spotlight sweep across a reveal card — the "glamorous shine". */
export function cardShine(card: HTMLElement): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const shine = document.createElement('span')
  shine.className = 'glam-shine'
  card.appendChild(shine)
  gsap.fromTo(
    shine,
    { xPercent: -160, opacity: 0 },
    { xPercent: 160, opacity: 1, duration: 0.9, ease: 'power2.inOut', onComplete: () => shine.remove() },
  )
}
