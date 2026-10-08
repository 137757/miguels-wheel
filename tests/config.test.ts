/**
 * Config invariants: weights sum correctly, ids are unique, prices are coherent.
 * Requirements 1, 2 and 15.
 */
import { describe, expect, it } from 'vitest'
import {
  comboPrice,
  config,
  menuPrices,
  mysteryPrizeDefinitions,
  prizeDefinitions,
  prizeTiers,
  sfxPaths,
  textures,
  validateConfig,
} from '../src/config/eventConfig.ts'
import {
  applyPriceEffect,
  comboPriceCents,
  formatPrice,
  toCents,
  type InventoryState,
} from '../src/core/prizes.ts'
import { fullInventory } from './helpers.ts'

describe('1 — top-level prize weights sum to 100', () => {
  it('sums to exactly 100', () => {
    expect(prizeDefinitions.reduce((a, p) => a + p.weight, 0)).toBe(100)
  })

  it('every weight is a positive integer', () => {
    for (const p of prizeDefinitions) {
      expect(Number.isInteger(p.weight), `${p.id}`).toBe(true)
      expect(p.weight).toBeGreaterThan(0)
    }
  })

  it('every prize has a known tier and a stock unit that exists', () => {
    for (const p of prizeDefinitions) {
      expect(prizeTiers).toContain(p.tier)
      if (p.stockUnit) {
        expect(p.stockUnit in config.inventory).toBe(true)
        expect(p.stockAmount).toBeGreaterThan(0)
      }
    }
  })
})

describe('2 — mystery prize weights sum to 100', () => {
  it('sums to exactly 100', () => {
    expect(mysteryPrizeDefinitions.reduce((a, p) => a + p.weight, 0)).toBe(100)
  })

  it('the bonus spin exists and is the rarest mystery outcome', () => {
    const bonus = mysteryPrizeDefinitions.find((p) => p.grantsBonusSpin)
    expect(bonus).toBeDefined()
    const others = mysteryPrizeDefinitions.filter((p) => !p.grantsBonusSpin).map((p) => p.weight)
    expect(bonus!.weight).toBeLessThan(Math.min(...others))
  })
})

describe('configuration validation', () => {
  it('reports no errors for the shipped config', () => {
    const errors = validateConfig().filter((i) => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('catches a broken weight sum', () => {
    const original = prizeDefinitions[0]!.weight
    prizeDefinitions[0]!.weight = original + 5
    try {
      const errors = validateConfig().filter((i) => i.level === 'error')
      expect(errors.some((e) => /expected 100/.test(e.message))).toBe(true)
    } finally {
      prizeDefinitions[0]!.weight = original
    }
  })

  it('catches a jackpot that is not the rarest prize', () => {
    const jackpot = prizeDefinitions.find((p) => p.id === 'free-combo')!
    const original = jackpot.weight
    jackpot.weight = 30
    try {
      const errors = validateConfig().filter((i) => i.level === 'error')
      expect(errors.some((e) => /rarest|lower than every other/i.test(e.message))).toBe(true)
    } finally {
      jackpot.weight = original
    }
  })

  it('rejects hotlinked assets', () => {
    const texturePaths = Object.entries(textures)
      .filter(([, v]) => typeof v === 'string')
      .map(([, v]) => String(v))
    const assetPaths: string[] = [...Object.values(sfxPaths), ...texturePaths]
    expect(assetPaths.length).toBeGreaterThan(10)
    for (const path of assetPaths) {
      expect(path).not.toMatch(/^https?:/)
      expect(path.startsWith('assets/')).toBe(true)
    }
  })
})

describe('15 — result prices', () => {
  it('$2 OFF => $13', () => {
    const twoOff = prizeDefinitions.find((p) => p.id === 'two-off')!
    expect(formatPrice(applyPriceEffect(comboPriceCents, twoOff.priceEffect))).toBe('$13')
  })

  it('50% OFF => $7.50', () => {
    const half = prizeDefinitions.find((p) => p.id === 'half-off')!
    expect(formatPrice(applyPriceEffect(comboPriceCents, half.priceEffect))).toBe('$7.50')
  })

  it('FREE COMBO => $0', () => {
    const free = prizeDefinitions.find((p) => p.id === 'free-combo')!
    expect(formatPrice(applyPriceEffect(comboPriceCents, free.priceEffect))).toBe('$0')
  })

  it('non-discount prizes leave the combo at its full price', () => {
    for (const id of ['sauce-upgrade', 'free-drink', 'free-fries', 'extra-chicken', 'mystery-box']) {
      const p = prizeDefinitions.find((x) => x.id === id)!
      expect(formatPrice(applyPriceEffect(comboPriceCents, p.priceEffect))).toBe('$15')
    }
  })

  it('mystery $3 OFF => $12', () => {
    const threeOff = mysteryPrizeDefinitions.find((p) => p.id === 'mystery-three-off')!
    expect(formatPrice(applyPriceEffect(comboPriceCents, threeOff.priceEffect))).toBe('$12')
  })

  it('prices use integer cents so no float drift reaches the customer', () => {
    const inv: InventoryState = fullInventory()
    expect(inv.extraDrink).toBeGreaterThan(0)
    expect(toCents(7.5)).toBe(750)
    expect(formatPrice(1500)).toBe('$15')
    expect(formatPrice(750)).toBe('$7.50')
  })

  it('the combo price matches the menu default', () => {
    expect(comboPrice).toBe(15)
    expect(menuPrices.combo).toBe(15)
  })
})
