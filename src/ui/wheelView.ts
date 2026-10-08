/**
 * The wheel view.
 *
 * Sectors are rendered straight from the frozen prize pool, so the arc on screen
 * IS the probability. Labels are radial and shrink/fall back to an icon when a
 * sector is too narrow, because a 3% wedge is only ~10.8° wide and no amount of
 * text fits inside it at a readable size.
 */

import gsap from 'gsap'
import { colours, ui } from '../config/eventConfig.ts'
import {
  fitsLabel,
  normalise,
  polarToCartesian,
  sectorPath,
  type Sector,
} from '../core/wheel.ts'
import { iconSvgEl, type IconName } from './icons.ts'

const R_OUTER = 500
const R_INNER = 118
const HUB_R = 104

/** setAttribute with numeric coercion — SVG attributes are all string-typed. */
function attr(node: Element, name: string, value: string | number): void {
  node.setAttribute(name, String(value))
}

const FILL: Record<string, { face: string; edge: string; text: string }> = {
  dark: { face: '#15100F', edge: '#2A2320', text: colours.cream },
  red: { face: '#B31D19', edge: '#7E1210', text: colours.cream },
  gold: { face: '#F6C344', edge: '#C08F1C', text: colours.ink },
  pink: { face: '#D93A63', edge: '#A22446', text: colours.cream },
  cream: { face: '#E6D7B4', edge: '#B9A882', text: colours.ink },
}

export interface WheelViewRefs {
  svg: SVGSVGElement
  sectorsGroup: SVGGElement
  sheenGroup: SVGGElement
  hubGroup: SVGGElement
  marquee: HTMLElement
  pointer: HTMLElement
  mount: HTMLElement
  scale: HTMLElement
}

export class WheelView {
  #refs: WheelViewRefs
  #sectors: Sector[] = []
  #bulbs: HTMLElement[] = []
  #rockTween: gsap.core.Tween | null = null
  #chaseRaf = 0
  #chaseStart = 0
  #chasePeriod = 3.6
  #chaseT = 0
  #sheenTween: gsap.core.Tween | null = null

  constructor(refs: WheelViewRefs) {
    this.#refs = refs
    this.#buildMarquee()
    this.#buildHub()
  }

  get sectors(): Sector[] {
    return this.#sectors
  }

  /* ------------------------------------------------------------- marquee --- */

  #buildMarquee(): void {
    const frag = document.createDocumentFragment()
    for (let i = 0; i < ui.marqueeBulbs; i++) {
      const b = document.createElement('span')
      b.className = 'bulb'
      b.style.setProperty('--a', `${(i / ui.marqueeBulbs) * 360}deg`)
      b.style.setProperty('--r', 'calc(50% - 0.9rem)')
      b.style.rotate = `${(i / ui.marqueeBulbs) * 360}deg`
      frag.appendChild(b)
      this.#bulbs.push(b)
    }
    this.#refs.marquee.appendChild(frag)
  }

  /**
   * Slow idle chase; `speed` > 1 while armed or spinning.
   *
   * Painted from rAF rather than a GSAP tween so 48 class toggles never land in
   * the same tick as the wheel's own onUpdate work.
   */
  setMarqueeSpeed(speed: number): void {
    this.#chasePeriod = 3.6 / Math.max(0.2, speed)
    this.#chaseT = 0
    cancelAnimationFrame(this.#chaseRaf)
    const loop = (now: number) => {
      if (!this.#chaseStart) this.#chaseStart = now
      const dt = (now - this.#chaseStart) / 1000
      this.#chaseT = (dt / this.#chasePeriod) * this.#bulbs.length
      const head = Math.floor(this.#chaseT) % this.#bulbs.length
      for (let i = 0; i < this.#bulbs.length; i++) {
        const d = (i - head + this.#bulbs.length) % this.#bulbs.length
        const el = this.#bulbs[i]!
        if (d < 3) {
          el.className = `bulb ${d === 0 ? 'is-hot' : 'is-red'}`
        } else if (d < 10) {
          el.className = 'bulb is-dim'
        } else {
          el.className = 'bulb'
        }
      }
      this.#chaseRaf = requestAnimationFrame(loop)
    }
    this.#chaseRaf = requestAnimationFrame(loop)
  }

  stopMarquee(): void {
    cancelAnimationFrame(this.#chaseRaf)
  }

  /* ----------------------------------------------------------------- hub --- */

  #buildHub(): void {
    const g = this.#refs.hubGroup
    g.innerHTML = ''
    const ns = 'http://www.w3.org/2000/svg'
    const mk = (t: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(ns, t)
      for (const [k, v] of Object.entries(attrs)) attr(e, k, v)
      return e
    }
    g.appendChild(mk('circle', { cx: 0, cy: 0, r: HUB_R + 16, fill: 'none', stroke: colours.gold, 'stroke-width': 3, opacity: 0.5 }))
    g.appendChild(mk('circle', { cx: 0, cy: 0, r: HUB_R, fill: 'url(#hubFace)', stroke: colours.cream, 'stroke-width': 4 }))
    g.appendChild(mk('circle', { cx: 0, cy: 0, r: HUB_R - 12, fill: 'none', stroke: colours.red, 'stroke-width': 2, opacity: 0.75, 'stroke-dasharray': '5 9' }))

    const g2 = mk('g', { transform: 'translate(0,0) rotate(-90)' })
    g2.appendChild(mk('circle', { cx: 0, cy: 0, r: 58, fill: colours.red, opacity: 0.95 }))
    g2.appendChild(mk('circle', { cx: 0, cy: 0, r: 58, fill: 'none', stroke: colours.gold, 'stroke-width': 3 }))
    // A real <text> node rather than a foreignObject: an HTML subtree inside the
    // rotating wheel would force a full layout pass every frame.
    const hubText = mk('text', {
      x: 0,
      y: 0,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill: colours.cream,
      'font-family': 'Bungee, Impact, sans-serif',
      'font-size': 26,
      'letter-spacing': 1,
    })
    hubText.textContent = 'SPIN'
    g2.appendChild(hubText)
    g.appendChild(g2)

    // Bolts around the hub for mechanical weight.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 360
      const p = polarToCartesian(HUB_R - 26, a)
      g.appendChild(mk('circle', { cx: Number(p.x.toFixed(1)), cy: Number(p.y.toFixed(1)), r: 3.4, fill: colours.gold, opacity: 0.7 }))
    }
  }

  /* ------------------------------------------------------------- sectors --- */

  /**
   * Render the wheel for a frozen prize pool. Any change in eligibility
   * (e.g. a stock pool hitting zero) must call this again so the geometry can
   * never disagree with the selection weights.
   */
  render(sectors: Sector[], opts: { jackpotId: string }): void {
    this.#sectors = sectors
    const g = this.#refs.sectorsGroup
    g.innerHTML = ''
    const ns = 'http://www.w3.org/2000/svg'

    for (const s of sectors) {
      const isJackpot = s.id === opts.jackpotId
      const pal = FILL[s.prize.fill] ?? FILL.dark!

      const wedge = document.createElementNS(ns, 'path')
      wedge.setAttribute('d', sectorPath(R_OUTER, R_INNER, s.start, s.end))
      wedge.setAttribute('fill', isJackpot ? colours.gold : pal.face)
      wedge.setAttribute('stroke', isJackpot ? '#8A6208' : pal.edge)
      attr(wedge, 'stroke-width', 3)
      g.appendChild(wedge)

      if (isJackpot) {
        // A subtle sheen so the rare wedge catches light as it passes the pointer.
        const sheen = document.createElementNS(ns, 'path')
        sheen.setAttribute('d', sectorPath(R_OUTER, R_INNER, s.start, s.end))
        sheen.setAttribute('fill', 'url(#jackpotSheen)')
        g.appendChild(sheen)
      }

      // Grain on the wedge face.
      const grain = document.createElementNS(ns, 'path')
      grain.setAttribute('d', sectorPath(R_OUTER, R_INNER, s.start, s.end))
      grain.setAttribute('fill', colours.ink)
      attr(grain, 'opacity', 0.07)
      grain.setAttribute('style', 'mix-blend-mode:multiply;pointer-events:none')
      g.appendChild(grain)

      this.#renderLabel(g, s, isJackpot ? colours.ink : pal.text)
    }

    // Outer + inner rims.
    const rim = document.createElementNS(ns, 'circle')
    attr(rim, 'cx', 0)
    attr(rim, 'cy', 0)
    attr(rim, 'r', R_OUTER)
    rim.setAttribute('fill', 'none')
    rim.setAttribute('stroke', colours.cream)
    attr(rim, 'stroke-width', 7)
    attr(rim, 'opacity', 0.9)
    g.appendChild(rim)

    const rimIn = document.createElementNS(ns, 'circle')
    attr(rimIn, 'cx', 0)
    attr(rimIn, 'cy', 0)
    attr(rimIn, 'r', R_INNER)
    rimIn.setAttribute('fill', 'none')
    rimIn.setAttribute('stroke', colours.cream)
    attr(rimIn, 'stroke-width', 4)
    attr(rimIn, 'opacity', 0.55)
    g.appendChild(rimIn)

    this.#buildSheen(sectors, opts.jackpotId)
  }

  /**
   * Place the sector's words and icon.
   *
   * A 3% wedge is only ~10.8° wide, which is far too narrow for words at the
   * default radius. Rather than dropping the label entirely, we try a series of
   * (radius, size) combinations — moving outward *grows* the available chord
   * (chord = 2r·sin(θ/2)) — and only fall back to icon-only if nothing fits.
   */
  #renderLabel(g: SVGGElement, s: Sector, textColour: string): void {
    const ns = 'http://www.w3.org/2000/svg'
    const mid = s.mid
    const isJackpot = s.prize.tier === 'JACKPOT'
    const isRare = s.prize.tier === 'RARE'
    const display = isJackpot || isRare ? "Anton, Impact, sans-serif" : "'Barlow Condensed', sans-serif"
    const label = s.prize.sectorLabel

    const R_MID = R_INNER + (R_OUTER - R_INNER) * 0.46
    const R_OUT = R_OUTER - 58
    const R_IN = R_INNER + 62

    // Preferred size for the tier, then progressively smaller fallbacks.
    const sizes = isJackpot ? [42, 30, 25, 21] : isRare ? [34, 26, 22, 19] : [30, 25, 21, 19]
    // Mid band first (reads best), then the wider outer band, then the inner one.
    const radii = [R_MID, R_OUT, R_IN]

    let placed: { r: number; size: number } | null = null
    outer: for (const r of radii) {
      for (const size of sizes) {
        if (fitsLabel(s.sweep, label.length, size, r)) {
          placed = { r, size }
          break outer
        }
      }
    }

    if (placed) {
      const t = document.createElementNS(ns, 'text')
      t.setAttribute('x', '0')
      t.setAttribute('y', '0')
      t.setAttribute('transform', `rotate(${mid}) translate(${placed.r} 0) rotate(90)`)
      t.setAttribute('text-anchor', 'middle')
      t.setAttribute('dominant-baseline', 'central')
      t.setAttribute('fill', textColour)
      t.setAttribute('font-family', display)
      t.setAttribute('font-weight', isJackpot || isRare ? '400' : '800')
      attr(t, 'font-size', placed.size)
      t.setAttribute('letter-spacing', isJackpot || isRare ? '0.5' : '1.2')
      t.textContent = label
      g.appendChild(t)
    }

    // The icon goes wherever the text did not. If the words took the outer band
    // the icon moves inward (and vice versa) so the two never collide.
    const iconR = placed ? (placed.r === R_OUT ? R_MID : R_OUT) : (R_OUTER + R_INNER) / 2
    const iconScale = placed ? 0.6 : isJackpot ? 0.9 : 0.78
    const holder = document.createElementNS(ns, 'g')
    holder.setAttribute('transform', `rotate(${mid}) translate(${iconR} 0) rotate(90) scale(${iconScale})`)
    holder.setAttribute('pointer-events', 'none')
    holder.appendChild(iconSvgEl(s.prize.icon as IconName))
    g.appendChild(holder)
  }

  /** The moving highlight that travels the jackpot wedge so the eye catches it. */
  #buildSheen(sectors: Sector[], jackpotId: string): void {
    const g = this.#refs.sheenGroup
    g.innerHTML = ''
    const sector = sectors.find((s) => s.id === jackpotId)
    if (!sector) return

    const ns = 'http://www.w3.org/2000/svg'
    const wedge = document.createElementNS(ns, 'path')
    wedge.setAttribute('d', sectorPath(R_OUTER, R_INNER, sector.start, sector.end))
    wedge.setAttribute('fill', 'url(#goldSweep)')
    wedge.setAttribute('style', 'pointer-events:none')
    g.appendChild(wedge)
    this.#sheenTween?.kill()
    this.#sheenTween = gsap.fromTo(
      wedge,
      { opacity: 0.18 },
      {
        opacity: 0.85,
        duration: 1.9,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        repeatDelay: 2.2,
      },
    )
  }

  stopSheen(): void {
    this.#sheenTween?.kill()
  }

  /* ------------------------------------------------------- idle + motion --- */

  /** A 1–2° rock so the idle screen is never dead. */
  startIdleRock(): void {
    this.#rockTween?.kill()
    this.#rockTween = gsap.to(this.#refs.scale, {
      rotate: 1.6,
      duration: 3.1,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      overwrite: 'auto',
    })
  }

  stopIdleRock(): void {
    this.#rockTween?.kill()
    gsap.to(this.#refs.scale, { rotate: 0, duration: 260, ease: 'power2.out' })
  }

  /** The wheel creeps toward the viewer as it slows. */
  creepScale(phase: 'ACCEL' | 'CRUISE' | 'DECEL'): void {
    const to = phase === 'DECEL' ? 1.06 : 1
    gsap.to(this.#refs.scale, { scale: to, duration: 600, ease: 'power2.out', overwrite: 'auto' })
  }

  resetScale(): void {
    gsap.to(this.#refs.scale, { scale: 1, duration: 320, ease: 'power2.out', overwrite: 'auto' })
  }

  /** Slight grow when armed. */
  setArmed(armed: boolean): void {
    gsap.to(this.#refs.mount, {
      scale: armed ? 1.045 : 1,
      duration: 700,
      ease: 'power3.out',
      overwrite: 'auto',
    })
  }

  /** Pointer flexes as boundaries pass. Called on every real crossing. */
  flexPointer(strength: number): void {
    const s = Math.min(1, strength)
    gsap.killTweensOf(this.#refs.pointer)
    gsap.fromTo(
      this.#refs.pointer,
      { rotate: -s * 15, y: s * 3 },
      { rotate: 0, y: 0, duration: 0.22, ease: 'elastic.out(1.1, 0.34)', overwrite: true },
    )
  }

  setPointerDimmed(dim: boolean): void {
    this.#refs.pointer.style.filter = dim ? 'drop-shadow(0 8px 16px rgba(0,0,0,.75)) saturate(.5)' : ''
  }
}

/** Angle helper re-exported so views do not need to import wheel maths directly. */
export { normalise }
