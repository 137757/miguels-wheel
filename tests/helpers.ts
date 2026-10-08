/** Shared test helpers. */

import {
  inventory as inventoryConfig,
  type InventoryKey,
} from '../src/config/eventConfig.ts'
import type { InventoryState } from '../src/core/prizes.ts'
import { __setRandomSource } from '../src/core/rng.ts'

export function fullInventory(): InventoryState {
  return {
    extraDrink: inventoryConfig.extraDrink.initial,
    extraFries: inventoryConfig.extraFries.initial,
    extraChicken: inventoryConfig.extraChicken.initial,
    sauceUpgrade: inventoryConfig.sauceUpgrade.initial,
  }
}

export function inventoryWithZero(unit: InventoryKey): InventoryState {
  return { ...fullInventory(), [unit]: 0 }
}

/**
 * Deterministic 32-bit PRNG (mulberry32) for reproducible test runs.
 *
 * Deliberately NOT a plain LCG: the code under test takes two consecutive words
 * for 53-bit floats and uses the low bits for bounded ints, and a weak LCG's
 * correlation between consecutive words would show up as a bogus failure in the
 * distribution tests rather than a real defect.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

export function useSeededRandom(seed = 12345): void {
  __setRandomSource(seededRandom(seed))
}

export function useRealRandom(): void {
  __setRandomSource(null)
}

/** A KeyValueStore that behaves like localStorage across "reloads". */
export class FakeStorage {
  #m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.#m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.#m.set(k, v)
  }
  removeItem(k: string): void {
    this.#m.delete(k)
  }
  get size(): number {
    return this.#m.size
  }
}
