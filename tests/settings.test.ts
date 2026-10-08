/**
 * Settings: custom wheel validation, geometry-odds agreement, persistence.
 */
import { describe, expect, it } from 'vitest'
import {
  defaultMysteryList,
  defaultPrizeList,
  validateConfig,
  validatePrizeList,
} from '../src/config/eventConfig.ts'
import { buildSectors } from '../src/core/wheel.ts'
import { activeWeightTotal, drawPrizeFrom } from '../src/core/prizes.ts'
import { EventStore } from '../src/core/store.ts'
import { FakeStorage, fullInventory } from './helpers.ts'

describe('settings — defaults are valid', () => {
  it('shipped lists validate clean', () => {
    expect(validatePrizeList(defaultPrizeList(), defaultMysteryList()).filter((i) => i.level === 'error')).toEqual([])
  })

  it('defaultPrizeList returns a clone, not an alias', () => {
    const a = defaultPrizeList()
    a[0]!.weight = 999
    expect(defaultPrizeList()[0]!.weight).not.toBe(999)
  })
})

describe('settings — validation catches bad wheels', () => {
  it('rejects weights that do not sum to 100', () => {
    const prizes = defaultPrizeList()
    prizes[0]!.weight = 50
    const errors = validatePrizeList(prizes, defaultMysteryList()).filter((i) => i.level === 'error')
    expect(errors.some((e) => /expected 100/.test(e.message))).toBe(true)
  })

  it('rejects fewer than 2 segments', () => {
    const prizes = defaultPrizeList().slice(0, 1)
    const errors = validatePrizeList(prizes, defaultMysteryList()).filter((i) => i.level === 'error')
    expect(errors.some((e) => /at least 2/.test(e.message))).toBe(true)
  })

  it('rejects duplicate ids', () => {
    const prizes = defaultPrizeList()
    prizes[1]!.id = prizes[0]!.id
    const errors = validatePrizeList(prizes, defaultMysteryList()).filter((i) => i.level === 'error')
    expect(errors.some((e) => /Duplicate/.test(e.message))).toBe(true)
  })

  it('rejects a jackpot that is not the rarest', () => {
    const prizes = defaultPrizeList()
    const jackpot = prizes.find((p) => p.tier === 'JACKPOT')!
    jackpot.weight = 40
    const errors = validatePrizeList(prizes, defaultMysteryList()).filter((i) => i.level === 'error')
    expect(errors.some((e) => /rarest|lower than every other/i.test(e.message))).toBe(true)
  })

  it('rejects an over-long sector label', () => {
    const prizes = defaultPrizeList()
    prizes[0]!.sectorLabel = 'THIS LABEL IS WAY TOO LONG'
    const errors = validatePrizeList(prizes, defaultMysteryList()).filter((i) => i.level === 'error')
    expect(errors.some((e) => /sector label/i.test(e.message))).toBe(true)
  })

  it('validateConfig accepts custom lists', () => {
    const prizes = defaultPrizeList()
    prizes[0]!.weight = 50
    const errors = validateConfig({ prizes, mystery: defaultMysteryList() }).filter((i) => i.level === 'error')
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('settings — equal slices, weighted draws for custom wheels', () => {
  it('a custom 50/30/20 wheel renders equal thirds with weighted odds', () => {
    const prizes = defaultPrizeList().slice(0, 3)
    prizes[0]!.weight = 50
    prizes[1]!.weight = 30
    prizes[2]!.weight = 20
    prizes[0]!.tier = 'COMMON'
    prizes[1]!.tier = 'MID'
    prizes[2]!.tier = 'JACKPOT'
    // jackpot (20) is rarest — valid by construction
    const sectors = buildSectors(prizes, 0)
    for (const s of sectors) expect(s.sweep).toBeCloseTo(120, 6)
    expect(sectors[0]!.probability).toBeCloseTo(0.5, 8)
    expect(sectors[1]!.probability).toBeCloseTo(0.3, 8)
    expect(sectors[2]!.probability).toBeCloseTo(0.2, 8)
    expect(activeWeightTotal(prizes)).toBe(100)
  })

  it('drawPrizeFrom draws from the custom list, not the static defaults', () => {
    const prizes = defaultPrizeList().slice(0, 3)
    prizes[0]!.id = 'custom-a'
    prizes[0]!.weight = 50
    prizes[0]!.tier = 'COMMON'
    prizes[1]!.id = 'custom-b'
    prizes[1]!.weight = 30
    prizes[1]!.tier = 'MID'
    prizes[2]!.id = 'custom-jackpot'
    prizes[2]!.weight = 20
    prizes[2]!.tier = 'JACKPOT'
    const draw = drawPrizeFrom(prizes, fullInventory(), { forcePrizeId: 'custom-b' })
    expect(draw.prize.id).toBe('custom-b')
    expect(draw.pool.map((p) => p.id)).toContain('custom-a')
  })
})

describe('settings — auto-rebalance', () => {
  it('scales any list to exactly 100 whole-number weights', async () => {
    const { normalizeWeights } = await import('../src/ui/settings.ts')
    for (const weights of [[25, 20, 17, 14, 10, 6, 5, 3], [50, 30, 20], [1, 1, 1], [99, 1], [7]]) {
      const list = weights.map((weight, i) => ({ id: `p${i}`, weight }))
      normalizeWeights(list)
      expect(list.reduce((a, p) => a + p.weight, 0)).toBe(100)
      for (const p of list) {
        expect(Number.isInteger(p.weight)).toBe(true)
        expect(p.weight).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('preserves relative odds ordering', async () => {
    const { normalizeWeights } = await import('../src/ui/settings.ts')
    const list = [
      { id: 'a', weight: 25 },
      { id: 'b', weight: 20 },
      { id: 'c', weight: 17 },
      { id: 'd', weight: 14 },
      { id: 'e', weight: 10 },
      { id: 'f', weight: 6 },
      { id: 'g', weight: 5 },
      { id: 'h', weight: 3 },
      { id: 'new', weight: 5 },
    ]
    normalizeWeights(list)
    const ordered = [...list].sort((x, y) => y.weight - x.weight).map((p) => p.id)
    expect(ordered[0]).toBe('a')
    expect(ordered[ordered.length - 1]).toBe('h')
    expect(list.reduce((a, p) => a + p.weight, 0)).toBe(100)
  })

  it('adding a segment then rebalancing keeps the jackpot rarest', () => {
    const prizes = defaultPrizeList()
    prizes.push({
      id: 'custom-prize',
      sectorLabel: 'CUSTOM',
      label: 'Custom prize',
      meaning: 'Custom',
      tier: 'COMMON',
      weight: 5,
      icon: 'ticket',
      fill: 'cream',
      priceEffect: { kind: 'none' },
      sfx: 'win-pop',
    })
    // Simulate the settings add flow (dynamic import avoids cycles).
    return import('../src/ui/settings.ts').then(({ normalizeWeights }) => {
      normalizeWeights(prizes)
      const errors = validatePrizeList(prizes, defaultMysteryList()).filter((i) => i.level === 'error')
      expect(errors).toEqual([])
    })
  })
})

describe('settings — persistence', () => {
  it('custom wheel survives a store reload', () => {
    const storage = new FakeStorage()
    const store = new EventStore(storage)
    const prizes = defaultPrizeList()
    prizes[0]!.sectorLabel = 'CUSTOM'
    prizes[0]!.weight = 24
    prizes[1]!.weight = 21 // keep total 100 (25->24, 20->21)
    const mystery = defaultMysteryList()
    store.setPrizes(prizes, mystery)

    const reloaded = new EventStore(storage)
    expect(reloaded.isCustomWheel).toBe(true)
    expect(reloaded.getPrizes()[0]!.sectorLabel).toBe('CUSTOM')
    expect(reloaded.getPrizes().reduce((a, p) => a + p.weight, 0)).toBe(100)
  })

  it('migrates a schema-1 state without losing spins', () => {
    const storage = new FakeStorage()
    storage.setItem(
      'miguels-wheel:v1',
      JSON.stringify({
        schema: 1,
        appVersion: '1.0.0',
        settings: { muted: false, fullscreen: false, mode: 'LIVE', inventory: fullInventory() },
        spins: [],
        pending: null,
        redeemedCount: 0,
        eventStartedAt: new Date().toISOString(),
      }),
    )
    const store = new EventStore(storage)
    expect(store.getPrizes().length).toBeGreaterThan(2)
    expect(store.isCustomWheel).toBe(false)
  })

  it('resetPrizes returns to shipped defaults', () => {
    const storage = new FakeStorage()
    const store = new EventStore(storage)
    store.setPrizes(defaultPrizeList(), defaultMysteryList())
    expect(store.isCustomWheel).toBe(true)
    store.resetPrizes()
    expect(store.isCustomWheel).toBe(false)
  })
})
