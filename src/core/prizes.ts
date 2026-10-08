/**
 * Prize eligibility, weighted selection and price resolution.
 *
 * The wheel's *visible* geometry and the *selection* weights are derived from the
 * same filtered prize list, so a sector can never be on screen with zero chance of
 * being drawn.
 */

import {
  comboPrice,
  mysteryPrizeDefinitions,
  prizeDefinitions,
  ui,
  type MysteryPrizeDefinition,
  type PriceEffect,
  type PrizeDefinition,
  type PrizeTier,
} from '../config/eventConfig.ts'
import { randomFloat, randomInt } from './rng.ts'

export interface InventoryState {
  extraDrink: number
  extraFries: number
  extraChicken: number
  sauceUpgrade: number
}

/**
 * A prize is ineligible when its stock pool is exhausted. Discount prizes have no
 * stock unit, so they never drop out — we can always honour a cheaper price.
 */
export function isEligible(prize: PrizeDefinition, inv: InventoryState): boolean {
  if (!prize.stockUnit) return true
  return (inv[prize.stockUnit] ?? 0) > 0
}

export function isMysteryEligible(prize: MysteryPrizeDefinition, inv: InventoryState): boolean {
  if (!prize.stockUnit) return true
  return (inv[prize.stockUnit] ?? 0) > 0
}

export interface Weighted<T> {
  item: T
  weight: number
}

export function activePrizes(inv: InventoryState, opts: { excludeMystery?: boolean } = {}): PrizeDefinition[] {
  return activePrizesFrom(prizeDefinitions, inv, opts)
}

export function isMysteryTrigger(prize: { id: string; tier?: string }): boolean {
  return prize.id === 'mystery-box' || prize.tier === 'SPECIAL'
}

export function activePrizesFrom(
  list: PrizeDefinition[],
  inv: InventoryState,
  opts: { excludeMystery?: boolean } = {},
): PrizeDefinition[] {
  return list.filter((p) => {
    if (opts.excludeMystery && isMysteryTrigger(p)) return false
    return isEligible(p, inv)
  })
}

export function activeMysteryPrizes(inv: InventoryState): MysteryPrizeDefinition[] {
  return activeMysteryPrizesFrom(mysteryPrizeDefinitions, inv)
}

export function activeMysteryPrizesFrom(
  list: MysteryPrizeDefinition[],
  inv: InventoryState,
): MysteryPrizeDefinition[] {
  return list.filter((p) => isMysteryEligible(p, inv))
}

/** Sum of the weights of the prizes that can actually be drawn. */
export function activeWeightTotal(prizes: PrizeDefinition[]): number {
  return prizes.reduce((a, p) => a + p.weight, 0)
}

/**
 * Weighted pick over the *already filtered* list. If the bonus spin has consumed the
 * Mystery Box, the remaining weights are renormalised automatically.
 */
export function pickWeighted<T extends { weight: number; id: string }>(
  items: readonly T[],
  forcedId?: string,
): T {
  if (items.length === 0) throw new Error('No eligible prizes to draw from')
  if (forcedId) {
    const forced = items.find((i) => i.id === forcedId)
    if (!forced) throw new Error(`Cannot force ineligible prize "${forcedId}"`)
    return forced
  }
  const total = items.reduce((a, i) => a + i.weight, 0)
  if (total <= 0) throw new Error('Total weight must be positive')
  let roll = randomFloat() * total
  for (const item of items) {
    roll -= item.weight
    if (roll < 0) return item
  }
  // Floating-point tail: return the final item rather than undefined.
  return items[items.length - 1]!
}

export interface DrawResult {
  prize: PrizeDefinition
  /** The eligible prize list the draw was taken from — freeze this for the spin. */
  pool: PrizeDefinition[]
  /** Normalised probability of this prize within the frozen pool. */
  probability: number
  excludedIds: string[]
}

export function drawPrize(
  inv: InventoryState,
  opts: { bonusSpin?: boolean; forcePrizeId?: string } = {},
): DrawResult {
  return drawPrizeFrom(prizeDefinitions, inv, opts)
}

export function drawPrizeFrom(
  list: PrizeDefinition[],
  inv: InventoryState,
  opts: { bonusSpin?: boolean; forcePrizeId?: string } = {},
): DrawResult {
  const excludedIds = list
    .filter((p) => !isEligible(p, inv) || (opts.bonusSpin && isMysteryTrigger(p)))
    .map((p) => p.id)
  const pool = activePrizesFrom(list, inv, { excludeMystery: Boolean(opts.bonusSpin) })
  const prize = pickWeighted(pool, opts.forcePrizeId)
  const total = activeWeightTotal(pool)
  return { prize, pool, probability: prize.weight / total, excludedIds }
}

export function drawMystery(inv: InventoryState, forcePrizeId?: string): MysteryPrizeDefinition {
  return drawMysteryFrom(mysteryPrizeDefinitions, inv, forcePrizeId)
}

export function drawMysteryFrom(
  list: MysteryPrizeDefinition[],
  inv: InventoryState,
  forcePrizeId?: string,
): MysteryPrizeDefinition {
  return pickWeighted(activeMysteryPrizesFrom(list, inv), forcePrizeId)
}

/* ------------------------------------------------------------------ money --- */

/** Cents, so no float drift creeps into the final price shown to a customer. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function fromCents(cents: number): number {
  return cents / 100
}

export function applyPriceEffect(baseCents: number, effect: PriceEffect): number {
  switch (effect.kind) {
    case 'none':
      return baseCents
    case 'off':
      return Math.max(0, baseCents - toCents(effect.amount))
    case 'percentOff':
      return Math.max(0, Math.round(baseCents * (1 - effect.percent / 100)))
    case 'free':
      return 0
  }
}

export function formatPrice(cents: number): string {
  const dollars = fromCents(cents)
  return `$${dollars.toFixed(2).replace(/\.00$/, '')}`
}

export const comboPriceCents = toCents(comboPrice)

/** Consumed stock for a win, or null for discount-only prizes. */
export function stockCostFor(
  prize: { stockUnit?: string; stockAmount?: number },
): { unit: keyof InventoryState; amount: number } | null {
  if (!prize.stockUnit || !prize.stockAmount) return null
  return { unit: prize.stockUnit as keyof InventoryState, amount: prize.stockAmount }
}

/**
 * A narrow jitter inside the safe centre of the winning sector, so two identical
 * prizes never stop at byte-identical angles while still never crossing a boundary.
 */
export function sectorSafeOffset(sweepDeg: number): number {
  const halfWidth = sweepDeg / 2
  const limit = halfWidth * ui.safeCentreFraction
  return randomRangeSafe(-limit, limit)
}

function randomRangeSafe(min: number, max: number): number {
  return min + (max - min) * (randomInt(0, 1_000_000) / 1_000_000)
}

/* ------------------------------------------------------------------ tiers --- */

export const TIER_ORDER: PrizeTier[] = ['COMMON', 'MID', 'SPECIAL', 'RARE', 'JACKPOT']

export function tierRank(t: PrizeTier): number {
  return TIER_ORDER.indexOf(t)
}
