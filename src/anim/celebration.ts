/**
 * Particles.
 *
 * The rule that matters: the jackpot must feel bigger than everything else. If a
 * $2-off discount rains confetti, the free combo is just another result and the
 * whole rarity structure collapses. So particle counts are tiered hard:
 *   COMMON ~25 · MID ~45 · SPECIAL (mystery) unique sequence · RARE ~90 · JACKPOT 150-250
 *
 * `prefers-reduced-motion` collapses every burst to a single gentle spray and is
 * applied globally by the app shell.
 */

import confetti, { type Options, type PathShape } from 'canvas-confetti'
import { colours } from '../config/eventConfig.ts'

const { gold, cream, red, pink, ink } = colours

let reduced = false
export function setReducedMotion(v: boolean): void {
  reduced = v
}

export function isReducedMotion(): boolean {
  return reduced
}

const GOLD = [gold, '#FFE08A', '#E0A81E']
const CREAM = [cream, '#FFF8E6']
const RED = [red, '#FF5A4E', '#B01B16']
const PINK = [pink, '#FF9BB6', '#D93A63']

type Shape = NonNullable<Options['shapes']>[number]

/**
 * A cherry-blossom petal.
 *
 * Expressed as a path-shape record rather than a drawing function: when the
 * browser supports OffscreenCanvas, canvas-confetti renders inside a Worker and
 * postMessages its options, so anything holding a closure throws
 * "could not be cloned" and no particles appear at all. A path record and a
 * plain matrix array survive structured cloning.
 *
 * Drawn in the same ±8 unit space the library's built-in shapes use.
 */
const petal: PathShape = {
  type: 'path',
  path: 'M0,-8 C5,-4 5.5,4 0,8 C-5.5,4 -5,-4 0,-8 Z',
  matrix: [1, 0, 0, 1, 0, 0],
}

/** Confetti's own star, reused rather than redrawn. */
const star: Shape = 'star'

function burst(count: number, opts: Partial<Options> & { origin?: Options['origin'] }): void {
  if (reduced) {
    confetti({
      particleCount: Math.min(14, Math.ceil(count / 8)),
      spread: 40,
      startVelocity: 14,
      ticks: 90,
      gravity: 0.5,
      scalar: 0.7,
      colors: CREAM,
      disableForReducedMotion: true,
      ...opts,
    })
    return
  }
  confetti({ particleCount: count, ticks: 260, ...opts })
}

/* ------------------------------------------------------------------ tiers --- */

/** Sauce upgrade: a quick, contained pop. Barely a celebration. */
export function commonSauce(): void {
  burst(22, {
    spread: 55,
    startVelocity: 22,
    gravity: 1.1,
    scalar: 0.85,
    ticks: 130,
    colors: [...RED, ...GOLD],
    shapes: ['square'],
  })
}

/** Free drink: pink liquid splash with ice-cube flecks. */
export function commonDrink(): void {
  burst(30, {
    spread: 70,
    startVelocity: 30,
    gravity: 1.2,
    scalar: 0.9,
    ticks: 160,
    colors: [...PINK, '#FFFFFF'],
    shapes: ['square', 'circle'],
    origin: { y: 0.78 },
  })
}

/** Free fries: a short downward sprinkle. Never long enough to get in the way. */
export function commonFries(): void {
  burst(26, {
    spread: 85,
    startVelocity: 18,
    gravity: 0.85,
    scalar: 0.75,
    ticks: 120,
    colors: [...GOLD, ...CREAM],
    shapes: ['square'],
    origin: { y: 0.1 },
  })
}

/** $2 off: stronger, more text impact, moderate spray. */
export function midCash(): void {
  burst(48, {
    spread: 100,
    startVelocity: 38,
    gravity: 1.15,
    scalar: 1,
    ticks: 200,
    colors: [...GOLD, ...CREAM],
    shapes: ['square', star],
  })
}

/** Extra chicken: a meaty, weightier burst. */
export function midChicken(): void {
  burst(45, {
    spread: 85,
    startVelocity: 34,
    gravity: 1.3,
    scalar: 1.05,
    ticks: 200,
    colors: [...RED, ...GOLD, ...CREAM],
    shapes: ['square', 'circle'],
  })
}

/** Mystery: a sparkle curtain for the box burst (the suspense is in the audio/lighting). */
export function mysteryBurst(): void {
  if (reduced) return
  confetti({
    particleCount: 46,
    spread: 360,
    startVelocity: 26,
    gravity: 0.9,
    scalar: 0.8,
    ticks: 200,
    colors: [...GOLD, ...CREAM, ...PINK],
    shapes: [star, 'circle'],
    origin: { x: 0.5, y: 0.5 },
  })
}

/** 50% off: rare-tier weight. Big, gold, heavier than anything mid. */
export function rareHalf(): void {
  burst(88, {
    spread: 120,
    startVelocity: 46,
    gravity: 1.15,
    scalar: 1.15,
    ticks: 280,
    colors: [...GOLD, ...RED, ...CREAM],
    shapes: ['square', star],
  })
  if (!reduced) {
    setTimeout(() => {
      confetti({
        particleCount: 40,
        angle: 60,
        spread: 70,
        startVelocity: 40,
        gravity: 1.1,
        scalar: 0.95,
        ticks: 220,
        colors: GOLD,
        shapes: ['square'],
        origin: { x: 0, y: 0.6 },
      })
      confetti({
        particleCount: 40,
        angle: 120,
        spread: 70,
        startVelocity: 40,
        gravity: 1.1,
        scalar: 0.95,
        ticks: 220,
        colors: GOLD,
        shapes: ['square'],
        origin: { x: 1, y: 0.6 },
      })
    }, 180)
  }
}

/**
 * JACKPOT. A glamorous ~3s spectacle: gold radial, twin cannons, paper storm,
 * star rain, blossom petals, and a final glitter fountain. Total ~280-380
 * particles — unmistakably bigger than RARE, never an endless wall.
 */
export function jackpot(): void {
  if (reduced) {
    burst(40, { spread: 360, startVelocity: 22, colors: GOLD, origin: { x: 0.5, y: 0.45 }, disableForReducedMotion: true })
    return
  }

  const common = {
    gravity: 1.1,
    ticks: 360,
    shapes: ['square', star] as Shape[],
  }

  // 1 — the gold radial from the centre of the crown drop.
  confetti({ ...common, particleCount: 90, spread: 360, startVelocity: 48, scalar: 1.25, colors: GOLD, origin: { x: 0.5, y: 0.42 } })

  // 2 — twin cannonades left and right, 120ms later. Bigger, sparklier.
  setTimeout(() => {
    confetti({ ...common, particleCount: 55, angle: 58, spread: 62, startVelocity: 62, scalar: 1.05, colors: GOLD, origin: { x: 0, y: 0.68 } })
    confetti({ ...common, particleCount: 55, angle: 122, spread: 62, startVelocity: 62, scalar: 1.05, colors: GOLD, origin: { x: 1, y: 0.68 } })
  }, 120)

  // 3 — cream/red paper storm.
  setTimeout(() => {
    confetti({ ...common, particleCount: 90, spread: 160, startVelocity: 42, scalar: 1.05, colors: [...CREAM, ...RED, ...GOLD], origin: { x: 0.5, y: 0.3 } })
  }, 420)

  // 4 — star rain from the top: pure glamour.
  setTimeout(() => {
    confetti({
      ...common,
      particleCount: 60,
      spread: 100,
      startVelocity: 26,
      gravity: 0.9,
      scalar: 1.1,
      ticks: 380,
      colors: ['#FFF6DA', '#FFE08A', ...GOLD],
      shapes: [star, 'circle'],
      origin: { x: 0.5, y: 0.05 },
    })
  }, 620)

  // 5 — the blossom petals. A Korean-street-market signature, not a party-popper.
  setTimeout(() => {
    confetti({
      particleCount: 42,
      spread: 170,
      startVelocity: 20,
      gravity: 0.35,
      scalar: 1.35,
      ticks: 460,
      drift: 0.9,
      colors: ['#FFC2D4', '#FFE0EA', pink],
      shapes: [petal],
      origin: { x: 0.5, y: 0.18 },
    })
  }, 820)

  // 6 — final glitter fountain, low and wide, for the lingering applause.
  setTimeout(() => {
    confetti({
      ...common,
      particleCount: 50,
      angle: 90,
      spread: 120,
      startVelocity: 55,
      gravity: 1.0,
      scalar: 0.9,
      ticks: 300,
      colors: [...GOLD, ...CREAM],
      origin: { x: 0.5, y: 0.85 },
    })
  }, 1200)
}

/** Small red shockwave on the SPIN button press. */
export function buttonShock(origin: { x: number; y: number }): void {
  if (reduced) return
  confetti({
    particleCount: 18,
    spread: 180,
    startVelocity: 16,
    gravity: 0,
    decay: 0.92,
    scalar: 1.5,
    ticks: 40,
    colors: [red, '#FF6A5E', gold],
    shapes: ['circle'],
    origin,
  })
}

/** Gold radial shockwave for the jackpot take-over. */
export function goldBurst(origin: { x: number; y: number }): void {
  if (reduced) return
  confetti({
    particleCount: 90,
    spread: 360,
    startVelocity: 62,
    gravity: 0.6,
    decay: 0.94,
    scalar: 1.35,
    ticks: 120,
    colors: [...GOLD, cream],
    shapes: ['square', star],
    origin,
  })
}

export const celebration = {
  commonSauce,
  commonDrink,
  commonFries,
  midCash,
  midChicken,
  mysteryBurst,
  rareHalf,
  jackpot,
  buttonShock,
  goldBurst,
}

export { ink }
