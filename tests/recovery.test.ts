/**
 * Recovery and inventory: requirements 10 and 13.
 *
 * A browser crash must never hand out a second draw, and an exhausted prize pool
 * must leave the wheel entirely — both in the code and on screen.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { prizeDefinitions } from '../src/config/eventConfig.ts'
import {
  activePrizes,
  activeWeightTotal,
  drawPrize,
  isEligible,
  type InventoryState,
} from '../src/core/prizes.ts'
import { buildSectors, planSpin, sectorAt, stopLandsIn } from '../src/core/wheel.ts'
import { EventStore, newSpinId, type PendingSpin } from '../src/core/store.ts'
import { FakeStorage, fullInventory, inventoryWithZero, useRealRandom, useSeededRandom } from './helpers.ts'

afterEach(() => useRealRandom())

function pendingFor(prizeId: string, mode: 'LIVE' | 'TEST' = 'LIVE'): PendingSpin {
  return {
    spinId: newSpinId(),
    createdAt: new Date().toISOString(),
    prizeId,
    prizeLabel: prizeDefinitions.find((p) => p.id === prizeId)!.label,
    poolIds: prizeDefinitions.map((p) => p.id),
    poolWeights: prizeDefinitions.map((p) => p.weight),
    bonusSpin: false,
    mode,
    baseComboPrice: 15,
    finalComboPrice: 15,
    discountAmount: 0,
    stockDelta: null,
    mysteryResolved: true,
    applicationVersion: '1.0.0',
    phase: 'SPINNING',
  }
}

describe('10 — reload restores the pending result rather than rerolling', () => {
  it('the pending spin survives a "reload" and is never re-drawn', () => {
    const backing = new FakeStorage()
    const first = new EventStore(backing, 'k')
    const chosen = drawPrize(fullInventory()).prize
    const p = pendingFor(chosen.id)
    // The prize is written to disk BEFORE any animation would start.
    first.setPending(p)

    // Simulate a browser reload: a brand new store over the same storage.
    const second = new EventStore(backing, 'k')
    expect(second.pending).not.toBeNull()
    expect(second.pending!.prizeId).toBe(p.prizeId)
    expect(second.pending!.spinId).toBe(p.spinId)
    expect(second.recoveryState()).toBe('ERROR_RECOVERY')
  })

  it('a reload after the reveal resumes at AWAITING_REDEMPTION, not a new draw', () => {
    const backing = new FakeStorage()
    const first = new EventStore(backing, 'k2')
    const p = { ...pendingFor('half-off'), phase: 'AWAITING_REDEMPTION' as const }
    first.setPending(p)
    const second = new EventStore(backing, 'k2')
    expect(second.recoveryState()).toBe('AWAITING_REDEMPTION')
    expect(second.pending!.prizeId).toBe('half-off')
  })

  it('1000 crash-reload cycles never change the drawn prize', () => {
    useSeededRandom(0xdead)
    const backing = new FakeStorage()
    const a = new EventStore(backing, 'k3')
    const original = drawPrize(fullInventory()).prize.id
    a.setPending(pendingFor(original))

    for (let i = 0; i < 1000; i++) {
      const reloaded = new EventStore(backing, 'k3')
      expect(reloaded.pending!.prizeId).toBe(original)
      // A crash must not consume or re-draw anything.
      expect(reloaded.spins).toHaveLength(0)
    }
  })

  it('a reward is not double-credited across a reload', () => {
    const backing = new FakeStorage()
    const a = new EventStore(backing, 'k4')
    a.setPending(pendingFor('free-combo'))
    // Redeem once, on the reloaded instance.
    const b = new EventStore(backing, 'k4')
    b.commitSpin({
      spinId: b.pending!.spinId,
      timestamp: b.pending!.createdAt,
      selectedPrizeId: b.pending!.prizeId,
      selectedPrizeLabel: b.pending!.prizeLabel,
      baseComboPrice: 15,
      finalComboPrice: 0,
      discountAmount: 15,
      bonusSpin: false,
      redeemed: true,
      applicationVersion: '1.0.0',
      mode: 'LIVE',
    })
    b.setPending(null)
    const c = new EventStore(backing, 'k4')
    expect(c.spins).toHaveLength(1)
    expect(c.pending).toBeNull()
    expect(c.recoveryState()).toBe('IDLE')
  })

  it('with no pending spin the app resumes cleanly at IDLE', () => {
    const store = new EventStore(new FakeStorage(), 'k5')
    expect(store.pending).toBeNull()
    expect(store.recoveryState()).toBe('IDLE')
  })

  it('corrupt storage falls back to defaults instead of crashing the stall', () => {
    const backing = new FakeStorage()
    backing.setItem('k6', '{not json')
    const store = new EventStore(backing, 'k6')
    expect(store.spins).toEqual([])
    expect(store.pending).toBeNull()
  })

  it('storage from a different schema version is discarded, not misread', () => {
    const backing = new FakeStorage()
    backing.setItem('k7', JSON.stringify({ schema: 99, spins: [{ spinId: 'bogus' }] }))
    const store = new EventStore(backing, 'k7')
    expect(store.spins).toEqual([])
  })
})

describe('13 — inventory reaching zero removes prize eligibility and its sector', () => {
  const stockBacked = prizeDefinitions.filter((p) => p.stockUnit)

  it('a prize with stock is ineligible once its pool is empty', () => {
    for (const p of stockBacked) {
      const inv = inventoryWithZero(p.stockUnit!)
      expect(isEligible(p, inv), p.id).toBe(false)
    }
  })

  it('an ineligible prize disappears from the drawn pool', () => {
    const inv = inventoryWithZero('extraFries')
    const pool = activePrizes(inv)
    expect(pool.find((p) => p.id === 'free-fries')).toBeUndefined()
    expect(pool).toHaveLength(prizeDefinitions.length - 1)
  })

  it('and its visible sector disappears too, with geometry renormalised', () => {
    const inv = inventoryWithZero('extraFries')
    const pool = activePrizes(inv)
    const sectors = buildSectors(pool, 0)
    expect(sectors).toHaveLength(prizeDefinitions.length - 1)
    expect(sectorAt(sectors, 0)!.id).not.toBe('free-fries')
    // A prize can never be visible with zero chance of being drawn.
    for (const s of sectors) {
      expect(s.probability).toBeGreaterThan(0)
      const p = pool.find((q) => q.id === s.id)!
      expect(isEligible(p, inv)).toBe(true)
    }
    expect(sectors.reduce((a, s) => a + s.sweep, 0)).toBeCloseTo(360, 8)
  })

  it('the remaining odds scale up proportionally', () => {
    const inv = inventoryWithZero('extraDrink')
    const pool = activePrizes(inv)
    const sectors = buildSectors(pool, 0)
    const sauce = sectors.find((s) => s.id === 'sauce-upgrade')!
    // 25 of the remaining 80 weight.
    expect(sauce.sweep).toBeCloseTo((25 / 80) * 360, 8)
  })

  it('an ineligible prize can never be drawn', () => {
    useSeededRandom(0x1111)
    const inv = inventoryWithZero('extraChicken')
    for (let i = 0; i < 100_000; i++) {
      expect(drawPrize(inv).prize.id).not.toBe('extra-chicken')
    }
  })

  it('discount-only prizes never drop out — a cheaper price is always honourable', () => {
    const inv: InventoryState = {
      extraDrink: 0,
      extraFries: 0,
      extraChicken: 0,
      sauceUpgrade: 0,
    }
    const pool = activePrizes(inv)
    const ids = pool.map((p) => p.id)
    expect(ids).toContain('two-off')
    expect(ids).toContain('half-off')
    expect(ids).toContain('free-combo')
    expect(ids).toContain('mystery-box')
    expect(ids).toHaveLength(4)
  })

  it('the jackpot remains the rarest sector after renormalisation', () => {
    const inv = inventoryWithZero('extraDrink')
    const sectors = buildSectors(activePrizes(inv), 0)
    const jackpot = sectors.find((s) => s.id === 'free-combo')!
    const smallest = Math.min(...sectors.filter((s) => s.id !== 'free-combo').map((s) => s.sweep))
    expect(jackpot.sweep).toBeLessThan(smallest)
  })

  it('a plan for an exhausted prize is refused rather than drawn', () => {
    const inv = inventoryWithZero('extraFries')
    const sectors = buildSectors(activePrizes(inv), 0)
    expect(() => planSpin(sectors, 'free-fries', 0, 5)).toThrow(/No sector on the wheel/)
  })

  it('drawing still works and still lands correctly with reduced stock', () => {
    useSeededRandom(0x2222)
    const inv = inventoryWithZero('sauceUpgrade')
    for (let i = 0; i < 2000; i++) {
      const sectors = buildSectors(activePrizes(inv), 0)
      const prize = drawPrize(inv).prize
      const plan = planSpin(sectors, prize.id, i * 9, 5)
      expect(stopLandsIn(sectors, plan.restAngle, prize.id)).toBe(true)
    }
  })

  it('stock counters never go negative and never oversell', () => {
    const store = new EventStore(new FakeStorage(), 'inv')
    store.setInventory({ extraDrink: 2, extraFries: 0, extraChicken: 0, sauceUpgrade: 0 })
    expect(store.consumeStock('extraDrink', 1)).toBe(1)
    expect(store.consumeStock('extraDrink', 5)).toBe(1)
    expect(store.inventory.extraDrink).toBe(0)
    expect(store.consumeStock('extraDrink', 1)).toBe(0)
    expect(store.inventory.extraDrink).toBe(0)
  })

  it('active weights total matches the pool it came from', () => {
    const inv = inventoryWithZero('extraFries')
    expect(activeWeightTotal(activePrizes(inv))).toBe(83)
  })
})
