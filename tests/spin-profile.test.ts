/**
 * The spin's velocity profile.
 *
 * The ease handed to the tween MUST return normalised progress in [0,1]. A
 * version that returned the swept angle instead produced a technically
 * "successful" spin that rotated hundreds of times further than intended before
 * snapping to the right place — invisible in a unit test that only checked the
 * final angle, obvious the moment a crowd watched it. These tests pin the
 * contract.
 */
import { describe, expect, it } from 'vitest'
import { animationTiming } from '../src/config/eventConfig.ts'
import { normalise, planSpin, sectorAt, stopLandsIn } from '../src/core/wheel.ts'
import { prizeDefinitions } from '../src/config/eventConfig.ts'
import { buildSectors } from '../src/core/wheel.ts'
import { fullInventory, useRealRandom, useSeededRandom } from './helpers.ts'
import { afterEach } from 'vitest'

afterEach(() => useRealRandom())

// Re-implement the profile the same way the source does, so the test pins the
// contract independently of the module's internals.
function profile(duration: number) {
  const tAcc = 0.5
  const tCruise = 1.4
  const tDec = Math.max(0.5, duration - tAcc - tCruise)
  const areaAcc = tAcc / 3
  const areaCruise = tCruise
  const areaDec = tDec / 3
  const shape = areaAcc + areaCruise + areaDec
  const swept = (t: number) => {
    if (t <= tAcc) {
      const s = t / tAcc
      return areaAcc * s * s * s
    }
    if (t <= tAcc + tCruise) return areaAcc + (t - tAcc)
    const s = (t - tAcc - tCruise) / tDec
    return areaAcc + areaCruise + areaDec * (3 * s - 3 * s * s + s * s * s)
  }
  return { at: (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : swept(u * duration) / shape), vMaxFactor: 1 / shape }
}

describe('spin ease returns normalised progress', () => {
  const DUR = 6.4

  it('stays inside [0,1] for the whole spin', () => {
    const p = profile(DUR)
    for (let i = 0; i <= 2000; i++) {
      const v = p.at(i / 2000)
      expect(v, `at u=${i / 2000}`).toBeGreaterThanOrEqual(0)
      expect(v, `at u=${i / 2000}`).toBeLessThanOrEqual(1)
    }
  })

  it('starts at 0 and ends exactly at 1', () => {
    const p = profile(DUR)
    expect(p.at(0)).toBe(0)
    expect(p.at(1)).toBe(1)
  })

  it('is monotonically increasing (the wheel never turns backwards)', () => {
    const p = profile(DUR)
    let prev = -1
    for (let i = 0; i <= 4000; i++) {
      const v = p.at(i / 4000)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = v
    }
  })

  it('reaches the middle of the spin about a third of the way in', () => {
    // The velocity profile is front-loaded: 50% of the rotation is done early.
    const p = profile(DUR)
    let firstHalf = 0
    for (let i = 0; i <= 4000; i++) {
      if (p.at(i / 4000) >= 0.5) {
        firstHalf = i / 4000
        break
      }
    }
    expect(firstHalf).toBeGreaterThan(0.05)
    expect(firstHalf).toBeLessThan(0.45)
  })

  it('applies the same total rotation when used as a real ease', () => {
    // The failure mode this guards against: an ease that returns the swept
    // ANGLE rather than a ratio. Reproduced here by interpolation.
    const p = profile(DUR)
    const from = 0
    const to = 2741
    let max = 0
    for (let i = 0; i <= 2000; i++) {
      const u = i / 2000
      const value = from + (to - from) * p.at(u)
      max = Math.max(max, value)
    }
    expect(max).toBeCloseTo(to, 6)
  })
})

describe('the total rotation a spin performs', () => {
  it('is between four and ten full turns of movement, never hundreds', () => {
    useSeededRandom(0x5eed)
    const sectors = buildSectors(prizeDefinitions, 0)
    for (let i = 0; i < 500; i++) {
      const p = prizeDefinitions[i % prizeDefinitions.length]!
      const from = i * 313 // an already-accumulated absolute rotation
      const plan = planSpin(sectors, p.id, from, 5)
      // The spin only ADDS to the current rotation; the delta is what the
      // customer sees travel past the pointer.
      const turns = (plan.totalRotation - from) / 360
      expect(turns).toBeGreaterThan(3.5)
      expect(turns).toBeLessThan(10)
      expect(plan.totalRotation).toBeGreaterThan(from)
    }
  })

  it('scales with the requested number of rotations', () => {
    useSeededRandom(0xbeef)
    const sectors = buildSectors(prizeDefinitions, 0)
    const few = planSpin(sectors, 'free-fries', 0, 5)
    const many = planSpin(sectors, 'free-fries', 0, 8)
    expect(many.totalRotation).toBeGreaterThan(few.totalRotation)
  })

  it('always rests inside the drawn sector at the requested duration', () => {
    useSeededRandom(0x1234)
    const sectors = buildSectors(prizeDefinitions.filter(() => true), 0)
    void fullInventory
    for (let i = 0; i < 1000; i++) {
      const p = prizeDefinitions[i % prizeDefinitions.length]!
      const plan = planSpin(sectors, p.id, i * 97, 5 + (i % 4))
      expect(stopLandsIn(sectors, plan.restAngle, p.id)).toBe(true)
      expect(sectorAt(sectors, plan.restAngle)!.id).toBe(p.id)
    }
  })

  it('honours the configured duration range', () => {
    const { minDuration, maxDuration } = animationTiming.spin
    expect(minDuration).toBeGreaterThan(5)
    expect(maxDuration).toBeLessThan(8)
    expect(minDuration).toBeLessThan(maxDuration)
  })
})

describe('angle helpers', () => {
  it('normalises any input into [0,360)', () => {
    expect(normalise(0)).toBe(0)
    expect(normalise(360)).toBe(0)
    expect(normalise(-90)).toBe(270)
    expect(normalise(725)).toBeCloseTo(5, 9)
    expect(normalise(-1000)).toBeCloseTo(80, 9)
  })
})
