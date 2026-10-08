/**
 * Wheel geometry.
 *
 * Every sector gets an EQUAL slice (360° / n) so the wheel always looks clean
 * and balanced no matter how the odds are tuned in Settings. The DRAW odds
 * stay weighted (`Sector.probability` = weight share) — geometry is display,
 * weights decide the prize. The exact % per segment is shown in Settings.
 *
 * Angle convention: 0° points right, increasing clockwise on screen (because SVG
 * y grows downward). The pointer lives at 12 o'clock = -90°.
 */

import { ui, type PrizeDefinition } from '../config/eventConfig.ts'
import { sectorSafeOffset } from './prizes.ts'

export interface Sector {
  id: string
  prize: PrizeDefinition
  /** Start angle in degrees, clockwise from 3 o'clock. */
  start: number
  /** End angle in degrees (exclusive), clockwise from 3 o'clock. */
  end: number
  /** Angular width in degrees — always 360 / n (equal slices). */
  sweep: number
  /** Midpoint of the sector. */
  mid: number
  /** Weighted draw probability as a fraction of the frozen pool (weight share). */
  probability: number
}

const FULL = 360

/**
 * Build EQUAL sectors from a frozen prize pool. `offsetDeg` rotates the whole
 * wheel so that sector 0 does not always begin at 3 o'clock.
 *
 * The slice a customer sees is always 360/n; the chance of landing on it is
 * the prize's weight share. Both come from the same filtered pool, so a sector
 * can never be on screen with zero chance of being drawn.
 */
export function buildSectors(prizes: PrizeDefinition[], offsetDeg = 0): Sector[] {
  if (prizes.length === 0) throw new Error('Cannot build a wheel with zero prizes')
  const total = prizes.reduce((a, p) => a + p.weight, 0)
  if (total <= 0) throw new Error('Cannot build a wheel with zero total weight')

  const sweep = FULL / prizes.length
  const out: Sector[] = []
  let cursor = offsetDeg % FULL
  for (const prize of prizes) {
    const start = normalise(cursor)
    const end = normalise(cursor + sweep)
    out.push({
      id: prize.id,
      prize,
      start,
      end,
      sweep,
      mid: normalise(start + sweep / 2),
      probability: prize.weight / total,
    })
    cursor += sweep
  }
  return out
}

export function normalise(deg: number): number {
  return ((deg % FULL) + FULL) % FULL
}

/** Smallest signed difference from a to b, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = normalise(to) - normalise(from)
  if (d > 180) d -= FULL
  if (d <= -180) d += FULL
  return d
}

export function sectorAt(sectors: Sector[], angleDeg: number): Sector | null {
  const a = normalise(angleDeg)
  for (const s of sectors) {
    const start = normalise(s.start)
    const sweep = s.sweep
    // Compare offsets from the sector start so a wrap-around sector still matches.
    const off = normalise(a - start)
    if (off < sweep || (sweep >= FULL - 1e-9 && off === 0)) return s
  }
  return null
}

/**
 * Wheel rotation (degrees, clockwise) required to bring `stopAngle` under the
 * pointer at `ui.pointerAngleDeg`.
 */
export function rotationForStop(stopAngle: number): number {
  return normalise(ui.pointerAngleDeg - stopAngle)
}

export interface SpinPlan {
  /** Total rotation applied to the wheel, in degrees, including extra turns. */
  totalRotation: number
  /** Absolute sector angle the wheel will come to rest at, before rotation. */
  restAngle: number
  sector: Sector
  /** Distance (deg) from the sector centre — always well inside the boundary. */
  offsetFromCentre: number
  rotations: number
}

/**
 * Build the spin plan for an already-decided prize. The animation is a *consequence*
 * of the draw, never the other way round.
 *
 * `currentRotation` is the wheel's ABSOLUTE accumulated rotation, not a 0–360
 * angle: after a few spins it is in the thousands, and normalising it here would
 * make the plan target a smaller angle than where the wheel already is — the
 * wheel would visibly spin backwards.
 */
export function planSpin(
  sectors: Sector[],
  prizeId: string,
  currentRotation: number,
  rotations: number,
): SpinPlan {
  const sector = sectors.find((s) => s.id === prizeId)
  if (!sector) throw new Error(`No sector on the wheel for prize "${prizeId}"`)

  const restAngle = normalise(sector.mid + sectorSafeOffset(sector.sweep))

  // Forward-only: a backwards flick would break the physical illusion.
  const target = rotationForStop(restAngle)
  const currentMod = normalise(currentRotation)
  const sweepToTarget = normalise(target - currentMod)
  // If the wheel already rests on the target, still travel a full turn so the
  // customer sees the wheel move rather than a dead stop.
  const forward = sweepToTarget < 1e-6 ? FULL : sweepToTarget

  // Top up with whole revolutions until the requested number of turns is met.
  const minForward = FULL * Math.max(1, rotations - 1)
  const extraTurns = Math.max(0, Math.ceil((minForward - forward) / FULL))

  return {
    totalRotation: currentRotation + forward + extraTurns * FULL,
    restAngle,
    sector,
    offsetFromCentre: Math.abs(angleDelta(restAngle, sector.mid)),
    rotations,
  }
}

/** True when the pointer lands unambiguously inside `sector`. */
export function stopLandsIn(sectors: Sector[], stopAngle: number, prizeId: string): boolean {
  const hit = sectorAt(sectors, stopAngle)
  return hit?.id === prizeId
}

/* ------------------------------------------------------------------- svg --- */

const RAD = Math.PI / 180

export function polarToCartesian(r: number, deg: number): { x: number; y: number } {
  const a = deg * RAD
  return { x: r * Math.cos(a), y: r * Math.sin(a) }
}

/** Annular sector path between inner and outer radius, centred on the origin. */
export function sectorPath(rOuter: number, rInner: number, start: number, end: number): string {
  // A full-circle sector cannot be expressed as a single arc pair; clamp to 359.999°.
  const sweep = Math.min(normalise(end - start) || FULL, FULL - 0.001)
  const mid = start + sweep / 2
  const largeArc = sweep > 180 ? 1 : 0

  const o1 = polarToCartesian(rOuter, start)
  const o2 = polarToCartesian(rOuter, mid)
  const o3 = polarToCartesian(rOuter, start + sweep)
  const i3 = polarToCartesian(rInner, start + sweep)
  const i2 = polarToCartesian(rInner, mid)
  const i1 = polarToCartesian(rInner, start)

  return [
    `M ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o2.x.toFixed(2)} ${o2.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o3.x.toFixed(2)} ${o3.y.toFixed(2)}`,
    `L ${i3.x.toFixed(2)} ${i3.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i2.x.toFixed(2)} ${i2.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

/**
 * Is a sector wide enough to fit its label at `radius`? Used to swap long labels
 * for short ones rather than letting text spill over a boundary.
 */
export function fitsLabel(sweepDeg: number, textLength: number, fontSize: number, radius: number): boolean {
  const chord = 2 * radius * Math.sin((sweepDeg * RAD) / 2)
  return textLength * fontSize * 0.58 <= chord
}
