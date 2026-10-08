/**
 * SINGLE SOURCE OF TRUTH.
 *
 * Menu prices, prize odds, prize meanings, inventory, timings and asset paths all
 * live here. Nothing in `src/ui`, `src/anim` or `src/audio` may hard-code a price,
 * a percentage or an asset filename — import from this module instead.
 *
 * Changing the combo price or any probability should require editing this file only.
 */

export const APP_VERSION = '1.0.0'
/** Alias kept for the persisted record field name. */
export const appVersion = APP_VERSION

/* ------------------------------------------------------------------ brand --- */

export const brand = {
  name: "Miguel's Fried Chicken",
  wordmark: ["MIGUEL'S", 'FRIED CHICKEN'],
  tagline: 'Korean Fried Chicken · Street Market',
  stallTag: 'MARKET DAY',
} as const

export const menuPrices = {
  /** Korean Fried Chicken */
  chicken: 8,
  /** Seoul Fries */
  fries: 5,
  /** Seoul Sunset Strawberry-Raspberry Ade */
  drink: 4,
  /** The combo. One combo == one wheel spin. */
  combo: 15,
} as const

export const comboPrice = menuPrices.combo

/* ----------------------------------------------------------------- colours --- */

export const colours = {
  ink: '#0A0909',
  red: '#E32620',
  cream: '#F2E4C4',
  gold: '#F6C344',
  pink: '#FF4F7B',
  white: '#FFFFFF',
} as const

/* --------------------------------------------------------------- textures --- */

export const textures = {
  paper: 'assets/textures/paper_269.jpg',
  paperDark: 'assets/textures/paper_183.jpg',
  inkPaint: 'assets/textures/inkpaint_306.jpg',
  grunge: 'assets/textures/grunge_336.jpg',
  /** Peak opacity for any texture layer. Deliberately low — these are atmosphere. */
  maxOpacity: 0.14,
} as const

/* ------------------------------------------------------------------- audio --- */

export const audioVolumes = {
  master: 0.85,
  /** Continuous background loop. Off by default: a noisy canteen already has plenty. */
  ambientEnabled: false,
  sfx: {
    'arm-click': 0.5,
    'spin-launch': 0.7,
    'button-thump': 0.95,
    'win-bell': 0.5,
    'win-pop': 0.5,
    'win-splash': 0.55,
    'win-sauce': 0.4,
    'win-coins': 0.5,
    'cash-ding': 0.6,
    'mystery-suspense': 0.5,
    'mystery-rumble': 0.55,
    'mystery-burst': 0.75,
    'mystery-sparkle': 0.55,
    'rare-impact': 0.85,
    'rare-stamp': 0.6,
    'jackpot-fanfare': 0.7,
    'jackpot-coins': 0.6,
    'jackpot-cheer': 0.65,
    'jackpot-orchestra': 0.55,
    'crowd-soft': 0.5,
    'reveal-dim': 0.4,
  },
} as const

export type SfxName = keyof typeof audioVolumes.sfx

export const sfxPaths: Record<SfxName, string> = {
  'arm-click': 'assets/audio/arm-click.mp3',
  'spin-launch': 'assets/audio/spin-launch.mp3',
  'button-thump': 'assets/audio/button-thump.mp3',
  'win-bell': 'assets/audio/win-bell.mp3',
  'win-pop': 'assets/audio/win-pop.mp3',
  'win-splash': 'assets/audio/win-splash.mp3',
  'win-sauce': 'assets/audio/win-sauce.mp3',
  'win-coins': 'assets/audio/win-coins.mp3',
  'cash-ding': 'assets/audio/cash-ding.mp3',
  'mystery-suspense': 'assets/audio/mystery-suspense.mp3',
  'mystery-rumble': 'assets/audio/mystery-rumble.mp3',
  'mystery-burst': 'assets/audio/mystery-burst.mp3',
  'mystery-sparkle': 'assets/audio/mystery-sparkle.mp3',
  'rare-impact': 'assets/audio/rare-impact.mp3',
  'rare-stamp': 'assets/audio/rare-stamp.mp3',
  'jackpot-fanfare': 'assets/audio/jackpot-fanfare.mp3',
  'jackpot-coins': 'assets/audio/jackpot-coins.mp3',
  'jackpot-cheer': 'assets/audio/jackpot-cheer.mp3',
  'jackpot-orchestra': 'assets/audio/jackpot-orchestra.mp3',
  'crowd-soft': 'assets/audio/crowd-soft.mp3',
  'reveal-dim': 'assets/audio/reveal-dim.mp3',
}

/* ------------------------------------------------------------------ timing --- */

export const animationTiming = {
  spin: {
    /** Total spin duration varies a little so no two spins feel identical. */
    minDuration: 5.8,
    maxDuration: 7.0,
    rotationsMin: 5,
    rotationsMax: 8,
    /** Quiet beat after the wheel stops, before the reveal fires. */
    silenceAfterStop: 0.19,
  },
  mystery: {
    boxEnter: 0.75,
    shakeDuration: 1.15,
    pauseBeforeBurst: 0.42,
    burst: 0.5,
    revealHold: 0.6,
  },
  jackpot: {
    darkness: 0.15,
    burst: 0.45,
    crownDrop: 0.7,
    textIn: 0.55,
    confettiSpread: 2.0,
    hold: 1.1,
  },
  common: { pop: 0.28, hold: 0.55 },
  mid: { pop: 0.36, hold: 0.7 },
  rare: { stamp: 0.5, shake: 0.45, hold: 0.9 },
} as const

/* ------------------------------------------------------------------ tiers --- */

export const prizeTiers = ['COMMON', 'MID', 'SPECIAL', 'RARE', 'JACKPOT'] as const
export type PrizeTier = (typeof prizeTiers)[number]

/* ------------------------------------------------------------- main prizes --- */

export type PriceEffect =
  | { kind: 'none' }
  | { kind: 'off'; amount: number }
  | { kind: 'percentOff'; percent: number }
  | { kind: 'free' }

export type InventoryKey = 'extraDrink' | 'extraFries' | 'extraChicken' | 'sauceUpgrade'

/**
 * `weight` values are *relative* and must total 100 across all prizes.
 * `stockUnit` names the inventory pool the prize consumes; discount prizes have
 * no `stockUnit` because they cost nothing to honour.
 */
export interface PrizeDefinition {
  id: string
  /** Short text drawn inside the wheel sector. Never a sentence. */
  sectorLabel: string
  /** Long form used on the result card and the staff panel. */
  label: string
  /** Extra line of plain-English meaning shown to the customer. */
  meaning: string
  tier: PrizeTier
  weight: number
  icon: 'sauce' | 'cup' | 'fries' | 'ticket' | 'drumstick' | 'gift' | 'half' | 'crown'
  /** Sector fill. Alternating wedges darken for legibility. */
  fill: 'dark' | 'red' | 'gold' | 'pink' | 'cream'
  priceEffect: PriceEffect
  stockUnit?: InventoryKey
  /** Inventory consumed per win. */
  stockAmount?: number
  sfx: SfxName
}

export const prizeDefinitions: PrizeDefinition[] = [
  {
    id: 'sauce-upgrade',
    sectorLabel: 'SAUCE',
    label: 'Sauce Upgrade',
    meaning: 'Extra Seoul Fire or Snow Cheese seasoning',
    tier: 'COMMON',
    weight: 25,
    icon: 'sauce',
    fill: 'cream',
    priceEffect: { kind: 'none' },
    stockUnit: 'sauceUpgrade',
    stockAmount: 1,
    sfx: 'win-sauce',
  },
  {
    id: 'free-drink',
    sectorLabel: 'FREE DRINK',
    label: 'Free Seoul Sunset',
    meaning: 'One extra full-size Seoul Sunset',
    tier: 'COMMON',
    weight: 20,
    icon: 'cup',
    fill: 'pink',
    priceEffect: { kind: 'none' },
    stockUnit: 'extraDrink',
    stockAmount: 1,
    sfx: 'win-splash',
  },
  {
    id: 'free-fries',
    sectorLabel: 'FREE FRIES',
    label: 'Free Fries',
    meaning: 'One extra serve of Seoul Fries',
    tier: 'COMMON',
    weight: 17,
    icon: 'fries',
    fill: 'red',
    priceEffect: { kind: 'none' },
    stockUnit: 'extraFries',
    stockAmount: 1,
    sfx: 'win-pop',
  },
  {
    id: 'two-off',
    sectorLabel: '$2 OFF',
    label: '$2 Off',
    meaning: 'Take $2 off this combo',
    tier: 'MID',
    weight: 14,
    icon: 'ticket',
    fill: 'cream',
    priceEffect: { kind: 'off', amount: 2 },
    sfx: 'cash-ding',
  },
  {
    id: 'extra-chicken',
    sectorLabel: 'EXTRA CHICKEN',
    label: 'Extra Chicken Piece',
    meaning: 'One additional large piece of chicken',
    tier: 'MID',
    weight: 10,
    icon: 'drumstick',
    fill: 'red',
    priceEffect: { kind: 'none' },
    stockUnit: 'extraChicken',
    stockAmount: 1,
    sfx: 'win-coins',
  },
  {
    id: 'mystery-box',
    sectorLabel: 'MYSTERY',
    label: 'Mystery Box',
    meaning: 'A second prize, revealed on the spot',
    tier: 'SPECIAL',
    weight: 6,
    icon: 'gift',
    fill: 'pink',
    priceEffect: { kind: 'none' },
    sfx: 'mystery-suspense',
  },
  {
    id: 'half-off',
    sectorLabel: 'HALF PRICE',
    label: '50% Off Combo',
    meaning: 'Half price on this combo',
    tier: 'RARE',
    weight: 5,
    icon: 'half',
    fill: 'red',
    priceEffect: { kind: 'percentOff', percent: 50 },
    sfx: 'rare-impact',
  },
  {
    id: 'free-combo',
    sectorLabel: 'FREE',
    label: 'Free Combo',
    meaning: 'This combo is completely free',
    tier: 'JACKPOT',
    weight: 3,
    icon: 'crown',
    fill: 'gold',
    priceEffect: { kind: 'free' },
    sfx: 'jackpot-fanfare',
  },
]

/* ---------------------------------------------------------- mystery prizes --- */

export interface MysteryPrizeDefinition {
  id: string
  sectorLabel: string
  label: string
  meaning: string
  weight: number
  priceEffect: PriceEffect
  stockUnit?: InventoryKey
  stockAmount?: number
  /** Requests another spin with Mystery excluded, so recursion is impossible. */
  grantsBonusSpin?: boolean
  sfx: SfxName
}

export const mysteryPrizeDefinitions: MysteryPrizeDefinition[] = [
  {
    id: 'mystery-friend-drink',
    sectorLabel: 'FOR A FRIEND',
    label: 'Free Seoul Sunset for a Friend',
    meaning: 'One extra Seoul Sunset — for a friend',
    weight: 35,
    priceEffect: { kind: 'none' },
    stockUnit: 'extraDrink',
    stockAmount: 1,
    sfx: 'win-splash',
  },
  {
    id: 'mystery-three-off',
    sectorLabel: '$3 OFF',
    label: '$3 Off This Combo',
    meaning: 'Take $3 off this combo',
    weight: 30,
    priceEffect: { kind: 'off', amount: 3 },
    sfx: 'cash-ding',
  },
  {
    id: 'mystery-two-chicken',
    sectorLabel: '2× CHICKEN',
    label: '2 Extra Chicken Pieces',
    meaning: 'Two additional large pieces of chicken',
    weight: 20,
    priceEffect: { kind: 'none' },
    stockUnit: 'extraChicken',
    stockAmount: 2,
    sfx: 'win-coins',
  },
  {
    id: 'mystery-bonus-spin',
    sectorLabel: 'BONUS SPIN',
    label: 'Bonus Spin',
    meaning: 'Spin again — on the house',
    weight: 15,
    priceEffect: { kind: 'none' },
    grantsBonusSpin: true,
    sfx: 'mystery-sparkle',
  },
]

/* -------------------------------------------------------------- inventory --- */

export const inventory = {
  /** Deliberately above the worst case so a promised prize is never refused. */
  extraDrink: { label: 'Extra drinks', unit: 'drinks', initial: 14 },
  extraFries: { label: 'Extra fries', unit: 'serves', initial: 12 },
  extraChicken: { label: 'Extra chicken', unit: 'pieces', initial: 12 },
  sauceUpgrade: { label: 'Sauce sachets', unit: 'sachets', initial: 40 },
} as const satisfies Record<InventoryKey, { label: string; unit: string; initial: number }>

export type InventoryKeyName = keyof typeof inventory

/** Purchasing notes for the day, derived from inventory + base serves. */
export const purchasingNotes = {
  expectedCombos: { min: 30, max: 50 },
  chickenKg: 6.5,
  friesKg: '7.5–8',
  drinkLitres: '13–14',
} as const

/* ------------------------------------------------------------ promotions --- */

export const promotionalMessages = [
  'EVERY COMBO GETS A SPIN',
  'EVERY SPIN WINS',
  'HIT THE JACKPOT — FREE COMBO',
] as const

export const promoRotateMs = 8500

/* ------------------------------------------------------------------ misc --- */

export const ui = {
  /** Sector pointer sits at 12 o'clock. */
  pointerAngleDeg: -90,
  /**
   * How far inside a winning sector the wheel is allowed to come to rest, as a
   * fraction of the sector's half-width. 0.62 keeps a wide safety margin so a
   * rounding error can never straddle a boundary.
   */
  safeCentreFraction: 0.62,
  /** Number of bulbs on the marquee ring. */
  marqueeBulbs: 48,
  storageKey: 'miguels-wheel:v1',
  title: "Miguel's Fried Chicken — Prize Wheel",
} as const

/* ------------------------------------------------------------- validation --- */

export interface ValidationIssue {
  level: 'error' | 'warning'
  message: string
}

const ASSET_KEYS = [
  ...Object.values(textures).filter((t) => typeof t === 'string' && t.startsWith('assets/')),
  ...Object.values(sfxPaths),
] as string[]

export const FILLS = ['dark', 'red', 'gold', 'pink', 'cream'] as const
export type PrizeFill = (typeof FILLS)[number]

export const ICONS = ['sauce', 'cup', 'fries', 'ticket', 'drumstick', 'gift', 'half', 'crown'] as const
export type PrizeIcon = (typeof ICONS)[number]

/** Deep clone of the shipped defaults — the starting point for the Settings page. */
export function defaultPrizeList(): PrizeDefinition[] {
  return JSON.parse(JSON.stringify(prizeDefinitions)) as PrizeDefinition[]
}

/** Deep clone of the shipped mystery defaults. */
export function defaultMysteryList(): MysteryPrizeDefinition[] {
  return JSON.parse(JSON.stringify(mysteryPrizeDefinitions)) as MysteryPrizeDefinition[]
}

/**
 * Validate an arbitrary prize list (shipped defaults or staff-customised).
 * Used by preflight AND by the Settings page live validator, so both agree.
 */
export function validatePrizeList(
  prizes: PrizeDefinition[],
  mystery: MysteryPrizeDefinition[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (m: string) => issues.push({ level: 'error', message: m })

  if (prizes.length < 2) err(`Wheel needs at least 2 segments, found ${prizes.length}`)
  if (prizes.length > 12) err(`Wheel supports at most 12 segments, found ${prizes.length}`)

  const mainSum = prizes.reduce((a, p) => a + p.weight, 0)
  if (mainSum !== 100) err(`Top-level prize weights sum to ${mainSum}, expected 100`)

  const mysterySum = mystery.reduce((a, p) => a + p.weight, 0)
  if (mysterySum !== 100) err(`Mystery prize weights sum to ${mysterySum}, expected 100`)

  const ids = new Set<string>()
  for (const p of prizes) {
    if (!p.id || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) err(`Prize id "${p.id}" must be slug-like (a-z, 0-9, dashes)`)
    if (ids.has(p.id)) err(`Duplicate prize id "${p.id}"`)
    ids.add(p.id)
    if (!Number.isInteger(p.weight) || p.weight <= 0) err(`Prize "${p.id}" needs a positive whole-number weight`)
    if (p.weight > 80) err(`Prize "${p.id}" weight ${p.weight} is too dominant — max 80`)
    if (!prizeTiers.includes(p.tier)) err(`Prize "${p.id}" has unknown tier "${p.tier}"`)
    if (!p.sectorLabel || p.sectorLabel.length > 14)
      err(`Prize "${p.id}" needs a short sector label (1–14 chars)`)
    if (!p.label) err(`Prize "${p.id}" needs a display label`)
    if (!(FILLS as readonly string[]).includes(p.fill)) err(`Prize "${p.id}" has unknown fill "${p.fill}"`)
    if (!(ICONS as readonly string[]).includes(p.icon)) err(`Prize "${p.id}" has unknown icon "${p.icon}"`)
    if (p.stockUnit && !(p.stockUnit in inventory)) {
      err(`Prize "${p.id}" references unknown inventory unit "${p.stockUnit}"`)
    }
    if (p.stockUnit && !p.stockAmount) err(`Prize "${p.id}" has a stock unit but no stock amount`)
    if (p.priceEffect.kind === 'off' && !(p.priceEffect.amount > 0))
      err(`Prize "${p.id}" $off needs a positive amount`)
    if (p.priceEffect.kind === 'percentOff' && !(p.priceEffect.percent > 0 && p.priceEffect.percent < 100))
      err(`Prize "${p.id}" percent-off must be 1–99`)
  }
  for (const p of mystery) {
    if (!p.id) err('Mystery prize needs an id')
    if (ids.has(p.id)) err(`Duplicate prize id "${p.id}"`)
    ids.add(p.id)
    if (!Number.isInteger(p.weight) || p.weight <= 0)
      err(`Mystery prize "${p.id}" needs a positive whole-number weight`)
    if (p.stockUnit && !(p.stockUnit in inventory)) {
      err(`Mystery prize "${p.id}" references unknown inventory unit "${p.stockUnit}"`)
    }
  }

  // The jackpot must be the rarest thing on the wheel, or the tiering is a lie.
  const jackpot = prizes.find((p) => p.tier === 'JACKPOT')
  if (!jackpot) err('Missing a JACKPOT-tier prize (e.g. free-combo)')
  else {
    const maxNonJackpot = Math.max(...prizes.filter((p) => p.tier !== 'JACKPOT').map((p) => p.weight))
    if (jackpot.weight >= maxNonJackpot) {
      err('Jackpot weight must be lower than every other prize weight')
    }
  }

  return issues
}

/**
 * Refuses to let a broken configuration run silently. Called at boot; any
 * `error` blocks entry to LIVE mode and is shown to staff on the preflight screen.
 *
 * Accepts an optional custom list so preflight can validate the staff-edited
 * wheel rather than only the shipped defaults.
 */
export function validateConfig(opts?: {
  prizes?: PrizeDefinition[]
  mystery?: MysteryPrizeDefinition[]
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (m: string) => issues.push({ level: 'error', message: m })
  const warn = (m: string) => issues.push({ level: 'warning', message: m })

  const prizes = opts?.prizes ?? prizeDefinitions
  const mystery = opts?.mystery ?? mysteryPrizeDefinitions
  issues.push(...validatePrizeList(prizes, mystery))

  for (const [name, price] of Object.entries(menuPrices)) {
    if (!Number.isFinite(price) || price <= 0) err(`menuPrices.${name} must be a positive number`)
  }
  if (comboPrice <= 0) err('comboPrice must be positive')

  for (const name of Object.keys(audioVolumes.sfx) as SfxName[]) {
    if (!sfxPaths[name]) err(`Missing asset path for sound "${name}"`)
  }
  for (const a of ASSET_KEYS) {
    if (typeof a !== 'string' || !a.startsWith('assets/')) err(`Asset path must be relative: "${a}"`)
    if (a.startsWith('http')) err(`Asset must not be hotlinked: "${a}"`)
  }

  if (ui.safeCentreFraction <= 0 || ui.safeCentreFraction >= 1) {
    err('ui.safeCentreFraction must be between 0 and 1')
  }
  if (animationTiming.spin.silenceAfterStop <= 0) err('silenceAfterStop must be positive')

  if (promotionalMessages.length < 1) warn('No promotional messages configured')

  return issues
}

export const config = {
  appVersion: APP_VERSION,
  brand,
  comboPrice,
  menuPrices,
  colours,
  textures,
  sfxPaths,
  audioVolumes,
  animationTiming,
  prizeDefinitions,
  mysteryPrizeDefinitions,
  prizeTiers,
  inventory,
  purchasingNotes,
  promotionalMessages,
  promoRotateMs,
  ui,
} as const

export type EventConfig = typeof config
