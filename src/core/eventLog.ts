/**
 * Event log reporting and export.
 *
 * No names, no personal information — only what is needed to reconcile the day
 * afterwards: spin count, discount prizes, jackpot count, promotional cost.
 */

import { comboPrice, mysteryPrizeDefinitions, prizeDefinitions } from '../config/eventConfig.ts'
import type { SpinRecord } from './store.ts'

export interface PrizeBreakdown {
  sauceUpgrade: number
  freeDrink: number
  freeFries: number
  twoOff: number
  extraChicken: number
  mysteryBox: number
  halfOff: number
  freeCombo: number
  bonusSpins: number
  /** Mystery sub-prize counts, keyed by mystery prize id. */
  mystery: Record<string, number>
}

export function emptyBreakdown(): PrizeBreakdown {
  return {
    sauceUpgrade: 0,
    freeDrink: 0,
    freeFries: 0,
    twoOff: 0,
    extraChicken: 0,
    mysteryBox: 0,
    halfOff: 0,
    freeCombo: 0,
    bonusSpins: 0,
    mystery: Object.fromEntries(mysteryPrizeDefinitions.map((m) => [m.id, 0])),
  }
}

const BUCKET: Record<string, keyof Omit<PrizeBreakdown, 'mystery'>> = {
  'sauce-upgrade': 'sauceUpgrade',
  'free-drink': 'freeDrink',
  'free-fries': 'freeFries',
  'two-off': 'twoOff',
  'extra-chicken': 'extraChicken',
  'mystery-box': 'mysteryBox',
  'half-off': 'halfOff',
  'free-combo': 'freeCombo',
}

export function summarise(spins: SpinRecord[]): {
  total: number
  redeemed: number
  breakdown: PrizeBreakdown
  discountGiven: number
  grossComboValue: number
  netTakings: number
} {
  const breakdown = emptyBreakdown()
  let discountGiven = 0
  let gross = 0
  let net = 0
  let redeemed = 0

  for (const s of spins) {
    if (s.bonusSpin) breakdown.bonusSpins += 1
    const bucket = BUCKET[s.selectedPrizeId]
    if (bucket) breakdown[bucket] += 1
    if (s.mysteryPrizeId) breakdown.mystery[s.mysteryPrizeId] = (breakdown.mystery[s.mysteryPrizeId] ?? 0) + 1
    discountGiven += s.discountAmount
    gross += s.baseComboPrice
    net += s.finalComboPrice
    if (s.redeemed) redeemed += 1
  }

  return {
    total: spins.length,
    redeemed,
    breakdown,
    discountGiven: round2(discountGiven),
    grossComboValue: round2(gross),
    netTakings: round2(net),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const CSV_COLUMNS = [
  'spinId',
  'timestamp',
  'selectedPrizeId',
  'selectedPrizeLabel',
  'mysteryPrizeId',
  'mysteryPrizeLabel',
  'baseComboPrice',
  'finalComboPrice',
  'discountAmount',
  'bonusSpin',
  'redeemed',
  'applicationVersion',
] as const

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(spins: SpinRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const s of spins) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(s[c])).join(','))
  }
  return lines.join('\n')
}

export function toJson(spins: SpinRecord[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      event: 'Miguel’s Fried Chicken — Market Day',
      comboPrice,
      summary: summarise(spins),
      spins,
    },
    null,
    2,
  )
}

export function download(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 1000)
}

export function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export const knownPrizeLabels: Record<string, string> = Object.fromEntries([
  ...prizeDefinitions.map((p) => [p.id, p.label]),
  ...mysteryPrizeDefinitions.map((m) => [m.id, m.label]),
])
