/**
 * Randomness: requirements 3 and 4.
 *
 * The weighted draw must actually match its published odds over a large sample,
 * and the RNG wrapper must never return a value outside its range.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  mysteryPrizeDefinitions,
  prizeDefinitions,
  type MysteryPrizeDefinition,
  type PrizeDefinition,
} from '../src/config/eventConfig.ts'
import {
  drawMystery,
  drawPrize,
  pickWeighted,
  type InventoryState,
} from '../src/core/prizes.ts'
import {
  __setRandomSource,
  hasSecureRandom,
  randomFloat,
  randomInt,
  randomUint32,
} from '../src/core/rng.ts'
import { fullInventory, useRealRandom, useSeededRandom } from './helpers.ts'

afterEach(() => {
  useRealRandom()
})

describe('3 — weighted selection approximates the configured distribution', () => {
  const N = 400_000

  it('top-level prizes match their published percentages', () => {
    useSeededRandom(0xc0ffee)
    const inv: InventoryState = fullInventory()
    const counts = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const id = drawPrize(inv).prize.id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const p of prizeDefinitions) {
      const seen = (counts.get(p.id) ?? 0) / N
      const expected = p.weight / 100
      // ±0.5 percentage points is a very tight bound for 400k samples.
      expect(Math.abs(seen - expected), `${p.id}: saw ${(seen * 100).toFixed(2)}% expected ${p.weight}%`).toBeLessThan(0.005)
    }
  })

  it('mystery sub-prizes match their published percentages', () => {
    useSeededRandom(0x5eed)
    const inv: InventoryState = fullInventory()
    const counts = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const id = drawMystery(inv).id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const m of mysteryPrizeDefinitions) {
      const seen = (counts.get(m.id) ?? 0) / N
      expect(Math.abs(seen - m.weight / 100), `${m.id}: saw ${(seen * 100).toFixed(2)}% expected ${m.weight}%`).toBeLessThan(0.006)
    }
  })

  it('a bonus spin can never draw Mystery Box, and the rest renormalise', () => {
    useSeededRandom(0xb0b0)
    const inv: InventoryState = fullInventory()
    const counts = new Map<string, number>()
    for (let i = 0; i < 120_000; i++) {
      const id = drawPrize(inv, { bonusSpin: true }).prize.id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect(counts.get('mystery-box') ?? 0).toBe(0)

    // Remaining 94 weight is shared across the other 7 prizes in proportion.
    for (const p of prizeDefinitions.filter((x) => x.id !== 'mystery-box')) {
      const seen = (counts.get(p.id) ?? 0) / 120_000
      const expected = p.weight / 94
      expect(Math.abs(seen - expected), `${p.id} on a bonus spin`).toBeLessThan(0.006)
    }
  })

  it('every prize is reachable and none is impossible', () => {
    useSeededRandom(7)
    const inv: InventoryState = fullInventory()
    const seen = new Set<string>()
    for (let i = 0; i < 200_000; i++) seen.add(drawPrize(inv).prize.id)
    expect(seen.size).toBe(prizeDefinitions.length)
  })

  it('never returns undefined from a weighted pick', () => {
    useSeededRandom(1)
    const items = prizeDefinitions as PrizeDefinition[]
    for (let i = 0; i < 50_000; i++) {
      const picked = pickWeighted(items)
      expect(picked).toBeDefined()
      expect(items).toContain(picked)
    }
    const mystery = pickWeighted(mysteryPrizeDefinitions as MysteryPrizeDefinition[])
    expect(mysteryPrizeDefinitions).toContain(mystery)
  })

  it('forced prizes are honoured and are the only way to force one', () => {
    useSeededRandom(3)
    const inv: InventoryState = fullInventory()
    for (const p of prizeDefinitions) {
      expect(drawPrize(inv, { forcePrizeId: p.id }).prize.id).toBe(p.id)
    }
    // Forcing a prize that the current pool has excluded must fail loudly.
    expect(() => drawPrize(inv, { bonusSpin: true, forcePrizeId: 'mystery-box' })).toThrow(/ineligible/i)
  })
})

describe('4 — the crypto RNG wrapper always returns a valid range', () => {
  it('has a real CSPRNG available in this environment', () => {
    expect(hasSecureRandom()).toBe(true)
  })

  it('randomUint32 stays inside [0, 2^32)', () => {
    useRealRandom()
    for (let i = 0; i < 20_000; i++) {
      const v = randomUint32()
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(2 ** 32)
    }
  })

  it('randomInt is inclusive on both bounds and never escapes them', () => {
    useRealRandom()
    const seen = new Set<number>()
    for (let i = 0; i < 20_000; i++) {
      const v = randomInt(3, 7)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7])
  })

  it('randomInt handles a zero-width range and inverted input safely', () => {
    useRealRandom()
    expect(randomInt(5, 5)).toBe(5)
    expect(() => randomInt(9, 2)).toThrow(/min <= max/)
    expect(() => randomInt(1.5, 3)).toThrow(/integer/)
  })

  it('randomFloat stays inside [0, 1) and covers the range', () => {
    useRealRandom()
    let min = 1
    let max = 0
    for (let i = 0; i < 20_000; i++) {
      const v = randomFloat()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(min).toBeLessThan(0.05)
    expect(max).toBeGreaterThan(0.95)
  })

  it('uses rejection sampling, so the distribution has no modulo bias', () => {
    // 3 does not divide 2^32, so a naive `% 3` would over-represent 0 and 1.
    useRealRandom()
    const counts = [0, 0, 0]
    const N = 90_000
    for (let i = 0; i < N; i++) counts[randomInt(0, 2)]! += 1
    for (const c of counts) {
      expect(Math.abs(c / N - 1 / 3)).toBeLessThan(0.005)
    }
  })

  it('refuses to draw when there is no secure source rather than falling back', () => {
    __setRandomSource(() => {
      throw new Error('no CSPRNG')
    })
    expect(() => randomUint32()).toThrow()
  })
})
