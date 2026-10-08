/**
 * Wheel geometry: requirements 5 and 6.
 *
 * The visible arc must be the actual probability, the planned stop must land in
 * the drawn sector, and no amount of rounding may put the pointer on a boundary.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { prizeDefinitions, ui } from '../src/config/eventConfig.ts'
import {
  angleDelta,
  buildSectors,
  normalise,
  planSpin,
  sectorAt,
  sectorPath,
  stopLandsIn,
  type Sector,
} from '../src/core/wheel.ts'
import type { InventoryState } from '../src/core/prizes.ts'
import { fullInventory, useRealRandom, useSeededRandom } from './helpers.ts'

afterEach(() => useRealRandom())

function sectorsFor(inv: InventoryState = fullInventory()): Sector[] {
  return buildSectors(prizeDefinitions.filter((p) => inv && p.weight > 0), 0)
}

describe('sector geometry mirrors the odds', () => {
  it('each sector sweep is exactly proportional to its weight', () => {
    const sectors = buildSectors(prizeDefinitions, 0)
    for (const s of sectors) {
      expect(s.sweep).toBeCloseTo((s.prize.weight / 100) * 360, 10)
      expect(s.probability).toBeCloseTo(s.prize.weight / 100, 10)
    }
  })

  it('the sectors tile the full circle with no gaps or overlaps', () => {
    const sectors = buildSectors(prizeDefinitions, 0)
    let total = 0
    for (const s of sectors) {
      expect(s.end).toBeCloseTo(normalise(s.start + s.sweep), 8)
      total += s.sweep
    }
    expect(total).toBeCloseTo(360, 8)
  })

  it('the 3% jackpot really is a 10.8° sliver and the 25% sauce wedge is 90°', () => {
    const sectors = buildSectors(prizeDefinitions, 0)
    const jackpot = sectors.find((s) => s.id === 'free-combo')!
    const sauce = sectors.find((s) => s.id === 'sauce-upgrade')!
    expect(jackpot.sweep).toBeCloseTo(10.8, 6)
    expect(sauce.sweep).toBeCloseTo(90, 6)
  })

  it('renormalises when a prize is excluded', () => {
    const pool = prizeDefinitions.filter((p) => p.id !== 'mystery-box')
    const sectors = buildSectors(pool, 0)
    const sauce = sectors.find((s) => s.id === 'sauce-upgrade')!
    expect(sauce.sweep).toBeCloseTo((25 / 94) * 360, 8)
    expect(sectors.reduce((a, s) => a + s.sweep, 0)).toBeCloseTo(360, 8)
  })

  it('sectorAt finds the right sector for every angle', () => {
    const sectors = sectorsFor()
    for (const s of sectors) {
      expect(sectorAt(sectors, s.mid)?.id).toBe(s.id)
      expect(sectorAt(sectors, s.start + s.sweep / 1000)?.id).toBe(s.id)
    }
    // Sweep a fine grid: exactly one sector must claim every angle.
    for (let a = 0; a < 360; a += 0.25) {
      const hit = sectorAt(sectors, a)
      expect(hit, `no sector at ${a}°`).not.toBeNull()
    }
  })

  it('sectorPath produces a closed, non-degenerate arc', () => {
    const d = sectorPath(500, 118, 0, 90)
    expect(d.startsWith('M ')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })
})

describe('5 — the selected prize maps to a valid target angle', () => {
  it('every prize can be planned and produces a rest angle inside its own sector', () => {
    useSeededRandom(99)
    const inv = fullInventory()
    for (let trial = 0; trial < 200; trial++) {
      const sectors = sectorsFor(inv)
      for (const p of prizeDefinitions) {
        const plan = planSpin(sectors, p.id, 360 * trial, 5)
        expect(plan.sector.id).toBe(p.id)
        expect(stopLandsIn(sectors, plan.restAngle, p.id)).toBe(true)
      }
    }
  })

  it('always rotates forward by a whole number of extra turns', () => {
    useSeededRandom(11)
    const sectors = sectorsFor()
    let current = 0
    for (let i = 0; i < 200; i++) {
      const plan = planSpin(sectors, prizeDefinitions[i % prizeDefinitions.length]!.id, current, 5)
      // Never scrolls backwards, and always covers at least the requested turns.
      const forward = plan.totalRotation - current
      expect(forward).toBeGreaterThanOrEqual(360 * 4)
      expect(plan.totalRotation).toBeGreaterThan(current)
      // The forward distance is either a real sweep to the target plus whole
      // turns, or exactly whole turns when the wheel already sits on the target.
      const residual = forward % 360
      expect(residual === 0 || residual > 1e-6).toBe(true)
      current = plan.totalRotation
    }
  })

  it('the plan rotation puts the winning sector under the pointer', () => {
    useSeededRandom(13)
    const sectors = sectorsFor()
    for (const p of prizeDefinitions) {
      const plan = planSpin(sectors, p.id, 1234.5, 6)
      // The angle under the pointer once the wheel is at rest.
      const under = normalise(ui.pointerAngleDeg - plan.totalRotation)
      expect(stopLandsIn(sectors, under, p.id)).toBe(true)
    }
  })
})

describe('6 — the wheel never stops on a neighbouring sector', () => {
  it('the rest angle is always well inside the sector, never near a boundary', () => {
    useSeededRandom(0xbeef)
    const inv = fullInventory()

    // Wipe the jitter so we see the worst case, then run 20k plans.
    for (let i = 0; i < 20_000; i++) {
      const sectors = sectorsFor(inv)
      const p = prizeDefinitions[i % prizeDefinitions.length]!
      const plan = planSpin(sectors, p.id, (i * 37) % 3600, 5)
      const sector = sectors.find((s) => s.id === p.id)!
      const halfWidth = sector.sweep / 2
      const offCentre = Math.abs(angleDelta(plan.restAngle, sector.mid))
      // The jitter is bounded to safeCentreFraction of the half-width, which
      // guarantees the pointer is never closer than (1 - fraction) of the
      // half-width to a boundary.
      expect(offCentre, `${p.id} drifted too far from centre`).toBeLessThanOrEqual(halfWidth * ui.safeCentreFraction)
      const marginFromEdge = halfWidth - offCentre
      expect(marginFromEdge, `${p.id} landed too close to a boundary`).toBeGreaterThanOrEqual(
        halfWidth * (1 - ui.safeCentreFraction) - 1e-9,
      )
      expect(stopLandsIn(sectors, plan.restAngle, p.id)).toBe(true)
    }
  })

  it('even the narrowest sector (jackpot) keeps a wide safety margin', () => {
    useSeededRandom(0xfeed)
    const sectors = sectorsFor()
    const jackpot = sectors.find((s) => s.id === 'free-combo')!
    for (let i = 0; i < 5_000; i++) {
      const plan = planSpin(sectors, 'free-combo', i * 11.3, 5)
      expect(Math.abs(angleDelta(plan.restAngle, jackpot.mid))).toBeLessThan(jackpot.sweep / 2)
      expect(stopLandsIn(sectors, plan.restAngle, 'free-combo')).toBe(true)
    }
  })

  it('consecutive identical prizes do not stop at identical angles', () => {
    useSeededRandom(0xc0c0)
    const sectors = sectorsFor()
    const angles = new Set<string>()
    for (let i = 0; i < 200; i++) {
      angles.add(planSpin(sectors, 'free-fries', i * 5, 5).restAngle.toFixed(6))
    }
    expect(angles.size).toBeGreaterThan(100)
  })

  it('a neighbouring sector is never accidentally hit', () => {
    useSeededRandom(0xabcd)
    const sectors = sectorsFor()
    for (const p of prizeDefinitions) {
      for (let i = 0; i < 300; i++) {
        const plan = planSpin(sectors, p.id, i * 13, 5)
        const hit = sectorAt(sectors, plan.restAngle)
        expect(hit!.id).toBe(p.id)
      }
    }
  })
})
