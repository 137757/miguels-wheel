/**
 * Application orchestrator.
 *
 * Owns the single source of truth for the current run: the state machine, the
 * persisted event state, the frozen prize pool, and the sequence
 *
 *   ARM -> spin -> stop -> SILENCE -> reveal -> staff confirms -> next
 *
 * Everything a spin touches is written to storage before the wheel moves, so a
 * crash mid-spin restores the same prize rather than minting a new one.
 */

import gsap from 'gsap'
import {
  appVersion,
  animationTiming,
  brand,
  colours,
  comboPrice,
  inventory as inventoryConfig,
  sfxPaths,
  textures,
  validateConfig,
  type InventoryKeyName,
  type MysteryPrizeDefinition,
  type PrizeDefinition,
} from './config/eventConfig.ts'
import { audio } from './audio/engine.ts'
import { SpinTimeline } from './anim/spin.ts'
import { buttonShock, setReducedMotion } from './anim/celebration.ts'
import { buildSectors, planSpin, type Sector } from './core/wheel.ts'
import {
  activePrizesFrom,
  applyPriceEffect,
  comboPriceCents,
  drawMysteryFrom,
  drawPrizeFrom,
  formatPrice,
  isEligible,
  isMysteryTrigger,
  stockCostFor,
  toCents,
  type InventoryState,
} from './core/prizes.ts'
import { randomInt } from './core/rng.ts'
import { WheelMachine, type State } from './core/machine.ts'
import { PerfGuard } from './core/perf.ts'
import { EventStore, newSpinId, type PendingSpin, type SpinRecord } from './core/store.ts'
import { WheelView } from './ui/wheelView.ts'
import { Revealer } from './ui/reveal.ts'
import { MysteryBox } from './ui/mystery.ts'
import { StaffPanel } from './ui/staffPanel.ts'
import { SettingsPanel } from './ui/settings.ts'
import { PreflightScreen } from './ui/preflight.ts'
import { GlamField, cardShine, winFlash } from './ui/glam.ts'
import './styles/tokens.css'
import './styles/base.css'
import './styles/stage.css'
import './styles/reveal.css'
import './styles/panels.css'
import './styles/settings.css'
import './styles/glam.css'

/* ------------------------------------------------------------------ helpers --- */

function el<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as unknown as T
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
setReducedMotion(reducedMotion)

/* -------------------------------------------------------------------- state --- */

const machine = new WheelMachine()
const store = new EventStore()

/** Prize pool currently rendered on the wheel, kept in sync with eligibility. */
let renderedSectors: Sector[] = []
let currentRotation = 0
let activePending: PendingSpin | null = null
let bonusArmed = false
let spinning = false
let revealBusy = false
let wakeLock: 'active' | 'unsupported' | 'inactive' = 'inactive'

/* --------------------------------------------------------------------- dom --- */

const dom = {
  start: el('screenStart'),
  startWheelMark: el('startWheelMark'),
  btnStart: el<HTMLButtonElement>('btnStart'),
  preflight: {
    screen: el('screenPreflight'),
    list: el('preflightList'),
    testBtn: el<HTMLButtonElement>('btnPreflightTest'),
    liveBtn: el<HTMLButtonElement>('btnEnterLive'),
  },
  stage: el<HTMLElement>('stage'),
  wheelMount: el('wheelMount'),
  wheelScale: el('wheelScale'),
  wheelRot: el('wheelRot'),
  wheelSvg: el<SVGSVGElement>('wheelSvg'),
  wheelSectors: el<SVGGElement>('wheelSectors'),
  wheelSheen: el<SVGGElement>('wheelSheen'),
  wheelHub: el<SVGGElement>('wheelHub'),

  marquee: el('marquee'),
  pointer: el('pointer'),
  spinBtn: el<HTMLButtonElement>('spinBtn'),
  turnCue: el('turnCue'),
  oddsLine: el('oddsLine'),
  comboCard: el('comboCard'),
  reveal: el('reveal'),
  revealScrim: el('revealScrim'),
  revealStage: el('revealStage'),
  mystery: {
    root: el('mystery'),
    box: el('mysteryBox'),
    label: el('mysteryLabel'),
  },
  staff: el('staffPanel'),
  staffBody: el('staffBody'),
  staffClose: el<HTMLButtonElement>('staffClose'),
  settings: el('settingsPanel'),
  glamCanvas: el<HTMLCanvasElement>('glamCanvas'),
  testWatermark: el('testWatermark'),
  toast: el('toast'),
}

/* ------------------------------------------------------------------- views --- */

const wheel = new WheelView({
  svg: dom.wheelSvg,
  sectorsGroup: dom.wheelSectors,
  sheenGroup: dom.wheelSheen,
  hubGroup: dom.wheelHub,
  marquee: dom.marquee,
  pointer: dom.pointer,
  mount: dom.wheelMount,
  scale: dom.wheelScale,
})

const revealer = new Revealer(
  { root: dom.reveal, scrim: dom.revealScrim, stage: dom.revealStage },
  reducedMotion,
)
const mystery = new MysteryBox(dom.mystery, reducedMotion)
const glam = new GlamField(dom.glamCanvas, reducedMotion, reducedMotion ? 0 : 70)

const preflight = new PreflightScreen(dom.preflight)

/**
 * Watch the real frame rate and shed decorative atmosphere if the display cannot
 * keep up. Only ever affects texture/motion layers, never the wheel or audio.
 */
const perf = new PerfGuard()
perf.onChange((lite) => {
  if (lite) {
    wheel.stopSheen()
    glam.stop()
    document.body.classList.add('perf-lite')
    console.info('[perf] Low frame rate detected — reducing decorative effects to keep the wheel smooth.')
  } else {
    glam.start()
    document.body.classList.remove('perf-lite')
  }
  staff.render()
})

/* --------------------------------------------------------------- rendering --- */

function jackpotId(): string {
  return store.getPrizes().find((p) => p.tier === 'JACKPOT')?.id ?? 'free-combo'
}

/**
 * Rebuild the wheel from whatever is currently eligible.
 *
 * Called after every stock change (and after Settings saves), so a sector can
 * never remain on screen with zero chance of being drawn.
 */
function refreshWheel(opts: { excludeMystery?: boolean } = {}): Sector[] {
  const inv = store.inventory
  const all = store.getPrizes()
  const pool = all.filter(
    (p) => isEligible(p, inv) && !(opts.excludeMystery && isMysteryTrigger(p)),
  )
  if (pool.length === 0) throw new Error('No eligible prizes remain — restock before continuing')
  const sectors = buildSectors(pool, 0)
  wheel.render(sectors, { jackpotId: jackpotId() })
  renderedSectors = sectors
  return sectors
}

/** True when a given prize currently has a visible sector on the wheel. */
function isOnWheel(prizeId: string): boolean {
  return renderedSectors.some((s) => s.id === prizeId)
}

function stageArmLevel(): string {
  switch (machine.state) {
    case 'IDLE':
      return '0'
    case 'ARMED':
    case 'BONUS_ARMED':
      return '1'
    case 'SPINNING':
      return '2'
    case 'REVEAL':
      return '3'
    default:
      return '4'
  }
}

function paintPublicState(): void {
  const st = machine.state
  dom.stage.dataset.armed = stageArmLevel()

  const canSpin = machine.canSpin
  // Self-serve: in IDLE the button is live and the first tap arms (it never
  // spins on the first tap — a stray touch can never mint a prize). Only ARMED
  // and BONUS_ARMED actually start the wheel.
  const spinReady = st === 'IDLE' || canSpin
  dom.spinBtn.disabled = !spinReady || spinning
  dom.spinBtn.classList.toggle('is-retracting', st === 'SPINNING')

  const showCue = st === 'IDLE' || st === 'ARMED' || st === 'BONUS_ARMED'
  dom.turnCue.hidden = !showCue
  if (showCue) {
    const line = dom.turnCue.querySelector('.turncue__line')!
    const sub = dom.turnCue.querySelector('.turncue__sub')!
    if (st === 'IDLE') {
      line.textContent = 'READY'
      sub.textContent = 'TAP SPIN TO ARM'
    } else {
      line.textContent = st === 'BONUS_ARMED' ? 'BONUS SPIN' : 'YOUR TURN'
      sub.textContent = st === 'BONUS_ARMED' ? 'ON THE HOUSE' : 'HIT SPIN'
    }
  }

  const isTest = store.settings.mode === 'TEST'
  dom.testWatermark.hidden = !isTest

  if (st === 'IDLE') {
    wheel.startIdleRock()
    wheel.setArmed(false)
    wheel.setMarqueeSpeed(1)
  } else if (st === 'ARMED' || st === 'BONUS_ARMED') {
    wheel.stopIdleRock()
    wheel.setArmed(true)
    wheel.setMarqueeSpeed(2.1)
  } else if (st === 'SPINNING' || st === 'REVEAL') {
    wheel.stopIdleRock()
    wheel.setMarqueeSpeed(3.4)
  } else {
    wheel.stopIdleRock()
  }

  if (st !== 'IDLE' && st !== 'ARMED' && st !== 'BONUS_ARMED') {
    dom.comboCard.style.opacity = '0.4'
  } else {
    dom.comboCard.style.opacity = ''
  }
  dom.oddsLine.textContent = `${renderedSectors.length || store.getPrizes().length} EQUAL SLICES · TRUE ODDS IN SETTINGS`

  staff.render()
}

/* -------------------------------------------------------------------- toast --- */

let toastTimer: ReturnType<typeof setTimeout> | null = null
function toast(message: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  dom.toast.textContent = message
  dom.toast.className = `toast toast--${kind}`
  // Errors interrupt; confirmations wait their turn. Set before the region is
  // revealed, because a politeness change on a live region that is already
  // showing is not reliably picked up.
  dom.toast.setAttribute('aria-live', kind === 'bad' ? 'assertive' : 'polite')
  dom.toast.hidden = false
  gsap.fromTo(dom.toast, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.24, ease: 'back.out(2)' })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true
  }, 3200)
}

/* ---------------------------------------------------------------- fullscreen --- */

function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement)
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch {
    toast('Fullscreen was blocked by the browser', 'bad')
  }
  store.patchSettings({ fullscreen: isFullscreen() })
  staff.render()
}

document.addEventListener('fullscreenchange', () => {
  store.patchSettings({ fullscreen: isFullscreen() })
  if (!isFullscreen() && machine.state !== 'BOOT') toast('Exited fullscreen — the wheel keeps working', 'info')
  staff.render()
})

/* ----------------------------------------------------------------- wake lock --- */

async function acquireWakeLock(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
  }
  if (!nav.wakeLock) {
    wakeLock = 'unsupported'
    return
  }
  try {
    const lock = await nav.wakeLock.request('screen')
    lock.release().catch(() => undefined)
    wakeLock = 'active'
  } catch {
    wakeLock = 'inactive'
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void acquireWakeLock()
})

/**
 * Stock changed under us (or via the staff panel). Rebuild the wheel if nothing
 * is in flight; otherwise defer, because a prize already on screen is owed to a
 * customer whether or not its stock has since run out.
 */
function staffNotifyInventory(): void {
  if (machine.state === 'IDLE' || machine.state === 'ARMED' || machine.state === 'PREFLIGHT') {
    refreshWheel({ excludeMystery: bonusArmed })
  } else {
    // Mid-spin or mid-reveal: the current prize is already owed to a customer,
    // so defer the rebuild until the flow finishes.
    wheelDirty = true
  }
  paintPublicState()
}

/* -------------------------------------------------------------- staff panel --- */

const staff = new StaffPanel(dom.staff, dom.staffBody, store, {
  arm: () => armSpin(),
  next: () => nextCustomer(),
  toggleMute: () => toggleMute(),
  toggleFullscreen: () => void toggleFullscreen(),
  testSpin: () => runTestSpin(),
  toggleMode: () => toggleTestMode(),
  forcePrize: (id) => {
    if (store.settings.mode !== 'TEST') {
      toast('Force prize is only available in TEST mode', 'bad')
      return
    }
    void beginSpin({ forcePrizeId: id })
  },
  reset: () => resetEvent(),
  openSettings: () => openSettings(),
  isFullscreen: () => isFullscreen(),
  isTestMode: () => store.settings.mode === 'TEST',
  isCustomWheel: () => store.isCustomWheel,
  audioState: () => ({
    ready: audio.ready,
    loaded: audio.loadedCount,
    total: Object.keys(sfxPaths).length,
    errors: audio.loadErrors,
  }),
  inventoryCap: (unit: InventoryKeyName) => inventoryConfig[unit].initial * 3,
  onInventoryChange: () => staffNotifyInventory(),
})

const settings = new SettingsPanel(dom.settings, store, {
  onSave: () => {
    // Rebuild immediately when idle/armed; defer mid-spin like inventory does.
    if (machine.state === 'IDLE' || machine.state === 'ARMED' || machine.state === 'PREFLIGHT' || machine.state === 'BONUS_ARMED') {
      try {
        refreshWheel({ excludeMystery: bonusArmed })
      } catch (e) {
        toast(String(e), 'bad')
      }
    } else {
      wheelDirty = true
    }
    validateAtBoot(true)
    paintPublicState()
  },
  onClose: () => {
    staff.render()
  },
  notify: (message, kind) => toast(message, kind ?? 'info'),
})

/** Set when stock changes while a spin is in flight; applied on the next idle. */
let wheelDirty = false

/** TEST-mode seam: pin the Mystery Box sub-prize. Cleared once consumed. */
let forcedMysteryPrizeId: string | undefined

function openSettings(): void {
  if (machine.state === 'SPINNING' || spinning) {
    toast('Finish the spin before editing the wheel', 'bad')
    return
  }
  if (machine.state === 'REVEAL' || revealBusy) {
    toast('Wait for the reveal to finish', 'bad')
    return
  }
  settings.show()
}

/* -------------------------------------------------------------- staff verbs --- */

function armSpin(): void {
  if (machine.state !== 'IDLE') {
    toast('Arm a spin only while IDLE', 'bad')
    return
  }
  if (pendingUnresolved()) {
    toast('Resolve the outstanding spin first', 'bad')
    return
  }
  machine.go('ARMED')
  bonusArmed = false
  audio.play('arm-click', { volume: 0.5 })
  paintPublicState()
  staff.render()
}

function nextCustomer(): void {
  // An animation in flight always wins. This guard has to come BEFORE the
  // AWAITING_REDEMPTION branch: recovering from a crash leaves the machine in
  // AWAITING_REDEMPTION while the resumed reveal is still playing, and staff
  // pressing "next customer" mid-animation must not cash the prize out from
  // under the reveal.
  if (machine.state === 'SPINNING' || spinning) {
    toast('The wheel is still spinning', 'info')
    return
  }
  if (machine.state === 'REVEAL' || revealBusy) {
    toast('Wait for the reveal to finish', 'info')
    return
  }
  // AWAITING_REDEMPTION is the only state where money actually changes hands.
  if (machine.state === 'AWAITING_REDEMPTION') {
    redeemPending()
    return
  }
  if (machine.state !== 'IDLE') {
    machine.go('IDLE')
  }
  bonusArmed = false
  refreshWheel()
  paintPublicState()
  staff.render()
  applyDeferredWheel()
}

function toggleMute(): void {
  const muted = !store.settings.muted
  store.patchSettings({ muted })
  audio.setMuted(muted)
  toast(muted ? 'Sound muted' : 'Sound on', 'info')
  paintPublicState()
}

function toggleTestMode(): void {
  if (machine.state !== 'IDLE' && machine.state !== 'PREFLIGHT') {
    toast('Switch mode only while idle', 'bad')
    return
  }
  const mode = store.settings.mode === 'LIVE' ? 'TEST' : 'LIVE'
  store.patchSettings({ mode })
  toast(mode === 'TEST' ? 'TEST MODE — results will not be counted' : 'LIVE MODE', mode === 'TEST' ? 'info' : 'good')
  paintPublicState()
}

async function runTestSpin(): Promise<void> {
  if (machine.state === 'SPINNING' || machine.state === 'REVEAL') return
  if (store.settings.mode !== 'TEST') store.patchSettings({ mode: 'TEST' })
  await beginSpin({ forcedTest: true })
}

function resetEvent(): void {
  store.reset()
  activePending = null
  bonusArmed = false
  currentRotation = 0
  gsap.set(dom.wheelRot, { rotation: 0 })
  refreshWheel()
  revealer.close()
  mystery.close()
  dom.reveal.hidden = true
  machine.restore('IDLE')
  paintPublicState()
  toast('Event reset — log, totals and inventory cleared', 'good')
}

function pendingUnresolved(): boolean {
  return store.pending !== null
}

/* -------------------------------------------------------------- the spin --- */

/**
 * The prize is decided and written to disk HERE, before any animation exists.
 */
function commitPending(prize: PrizeDefinition, inv: InventoryState, bonus: boolean, mode: 'LIVE' | 'TEST'): PendingSpin {
  const pool = store.getPrizes().filter((p) => isEligible(p, inv) && !(bonus && isMysteryTrigger(p)))
  const cost = stockCostFor(prize)
  const finalCents = applyPriceEffect(comboPriceCents, prize.priceEffect)

  const pending: PendingSpin = {
    spinId: newSpinId(),
    createdAt: new Date().toISOString(),
    prizeId: prize.id,
    prizeLabel: prize.label,
    poolIds: pool.map((p) => p.id),
    poolWeights: pool.map((p) => p.weight),
    bonusSpin: bonus,
    mode,
    baseComboPrice: comboPrice,
    finalComboPrice: finalCents / 100,
    discountAmount: (comboPriceCents - finalCents) / 100,
    stockDelta: cost ? { unit: cost.unit, amount: cost.amount } : null,
    mysteryResolved: !isMysteryTrigger(prize),
    applicationVersion: appVersion,
    phase: 'SPINNING',
  }
  store.setPending(pending)
  activePending = pending
  return pending
}

async function beginSpin(opts: { forcePrizeId?: string; forcedTest?: boolean } = {}): Promise<void> {
  if (spinning || revealBusy) return
  if (machine.state === 'SPINNING' || machine.state === 'REVEAL') return

  // 1 — claim the spin right. Losers of a double-click are rejected outright.
  // Capture the bonus flag BEFORE claiming, because claimSpin() moves us to SPINNING.
  const wasBonus = bonusArmed && machine.state === 'BONUS_ARMED'

  // 0 — validate a forced prize before the spin right is claimed. A bad id must
  //     surface as a refusal, not as a throw that strands the machine.
  if (opts.forcePrizeId) {
    const eligible = activePrizesFrom(store.getPrizes(), store.inventory, { excludeMystery: bonusArmed && machine.state === 'BONUS_ARMED' })
    if (!eligible.some((p) => p.id === opts.forcePrizeId)) {
      toast(`Cannot force "${opts.forcePrizeId}" — it is not on the wheel right now`, 'bad')
      return
    }
  }

  if (machine.state !== 'ARMED' && machine.state !== 'BONUS_ARMED') {
    if (!opts.forcedTest) {
      toast('Press ARM SPIN first', 'bad')
      return
    }
    if (machine.state === 'START' || machine.state === 'PREFLIGHT' || machine.state === 'BOOT') {
      machine.restore('IDLE')
    }
    if (machine.state === 'AWAITING_REDEMPTION') {
      toast('Redeem the previous customer first', 'info')
      return
    }
    machine.go('ARMED')
  }
  if (!machine.claimSpin()) {
    toast('Already spinning', 'info')
    return
  }
  spinning = true
  bonusArmed = false
  paintPublicState()

  const mode: 'LIVE' | 'TEST' = store.settings.mode
  const inv = store.inventory

  // 2 — decide the prize, cryptographically, and freeze the pool.
  //    The forced id is checked BEFORE anything else can throw: claiming the
  //    spin above has already moved us to SPINNING, so a throw from here would
  //    otherwise leave the wheel permanently wedged with no way back to IDLE.
  //    Uses the staff-customised wheel when present.
  const draw = drawPrizeFrom(store.getPrizes(), inv, { bonusSpin: wasBonus, forcePrizeId: opts.forcePrizeId })
  commitPending(draw.prize, inv, wasBonus, mode)

  // 3 — build the geometry from the SAME frozen pool the draw used, so the arc
  //     the customer watches is the arc that was drawn from.
  const pool = store.getPrizes().filter((p) => draw.pool.some((q) => q.id === p.id))
  const sectors = buildSectors(pool, 0)
  wheel.render(sectors, { jackpotId: jackpotId() })
  renderedSectors = sectors

  const rotations = randomInt(animationTiming.spin.rotationsMin, animationTiming.spin.rotationsMax)
  const plan = planSpin(sectors, draw.prize.id, currentRotation, rotations)

  // 4 — PHASE 1: button impact.
  audio.thump(96, 0.24, 0.55)
  audio.play('spin-launch', { volume: 0.6, when: 0.06 })
  const shock = {
    x: dom.spinBtn.getBoundingClientRect().left + dom.spinBtn.getBoundingClientRect().width / 2,
    y: dom.spinBtn.getBoundingClientRect().top + dom.spinBtn.getBoundingClientRect().height / 2,
  }
  if (!reducedMotion) {
    buttonShock({ x: shock.x / window.innerWidth, y: shock.y / window.innerHeight })
  }
  if (!reducedMotion) {
    await gsap
      .timeline()
      .to(dom.spinBtn, { scale: 0.88, duration: 0.07, ease: 'power2.in' })
      .to(dom.spinBtn, { scale: 1.07, duration: 0.1, ease: 'power2.out' })
      .to(dom.spinBtn, { scale: 1, opacity: 0.25, duration: 0.2, ease: 'power2.in' })
      .then()
  }

  // 5 — the spin itself.
  const timeline = new SpinTimeline()
  const stopped = timeline.run({
    wheel: dom.wheelRot,
    sectors,
    plan,
    currentRotation,
    reducedMotion,
    onTick: ({ crossings, intensity }) => {
      // Every real boundary crossing gets a tick; the audio engine rate-limits
      // the top end so it stays a tick and not a buzz.
      audio.tick(intensity)
      if (crossings > 0) wheel.flexPointer(Math.min(1, intensity + 0.2))
    },
    onUpdate: (t) => {
      currentRotation = t.rotation
      wheel.creepScale(t.phase)
    },
    onStop: () => {
      currentRotation = plan.totalRotation
    },
  })

  await stopped

  // 6 — the silence. 150–220ms of nothing so the crowd registers where it landed.
  activePending && (activePending.phase = 'REVEAL')
  store.setPending(activePending)
  audio.duck(0.3, animationTiming.spin.silenceAfterStop + 0.2)
  dom.stage.dataset.armed = '3'
  await wait(animationTiming.spin.silenceAfterStop * 1000)
  audio.unduck(0)

  // 7 — the reveal.
  spinning = false
  machine.go('REVEAL')
  paintPublicState()

  if (isMysteryTrigger(draw.prize)) {
    await runMystery()
  } else {
    await runReveal(draw.prize, inv)
  }

  machine.go('AWAITING_REDEMPTION')
  if (activePending) {
    activePending.phase = 'AWAITING_REDEMPTION'
    store.setPending(activePending)
  }
  paintPublicState()
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/* ------------------------------------------------------------ the reveals --- */

async function runReveal(prize: PrizeDefinition, _inv: InventoryState): Promise<void> {
  revealBusy = true
  const pending = activePending
  const stock = stockCostFor(prize)
  if (stock && pending?.mode === 'LIVE') store.consumeStock(stock.unit, stock.amount)

  // Glam: flash + gold dust, tier-scaled. Jackpot gets the full rain.
  winFlash(prize.tier)
  if (prize.tier === 'JACKPOT') glam.jackpotRain()
  else glam.burst(0.5, 0.42, prize.tier === 'RARE' ? 55 : prize.tier === 'MID' ? 32 : 20)

  audio.play(prize.sfx, { volume: 0.85 })

  await revealer.show(prize, store.inventory)
  // Shine sweep across the settled prize card.
  const card = dom.revealStage.querySelector('.prize, .jackpot-layer') as HTMLElement | null
  if (card) cardShine(card)
  revealBusy = false
}

async function runMystery(): Promise<void> {
  revealBusy = true
  const pending = activePending
  if (!pending) {
    // Never leave the flag stuck: nextCustomer() refuses to act while it is
    // set, so a stranded true would wedge the wheel for the rest of the event.
    revealBusy = false
    return
  }

  audio.play('mystery-burst', { volume: 0.3 })

  winFlash('SPECIAL')
  glam.burst(0.5, 0.5, 40)
  const mysteryPrize: MysteryPrizeDefinition = drawMysteryFrom(store.getMysteryPrizes(), store.inventory, forcedMysteryPrizeId)
  forcedMysteryPrizeId = undefined
  // Persist the sub-prize before showing it — a crash mid-mystery must not re-roll it.
  pending.mysteryPrizeId = mysteryPrize.id
  pending.mysteryPrizeLabel = mysteryPrize.label
  pending.mysteryResolved = true
  store.setPending(pending)

  const finalCents = applyPriceEffect(comboPriceCents, mysteryPrize.priceEffect)
  pending.finalComboPrice = finalCents / 100
  pending.discountAmount = (comboPriceCents - finalCents) / 100
  const cost = stockCostFor(mysteryPrize)
  pending.stockDelta = cost ? { unit: cost.unit, amount: cost.amount } : null
  if (cost && pending.mode === 'LIVE') store.consumeStock(cost.unit, cost.amount)
  store.setPending(pending)

  await mystery.run(mysteryPrize, finalCents, audio)
  revealBusy = false
  if (mysteryPrize.grantsBonusSpin) {
    // Only raise the flag here. The machine still has to walk
    // REVEAL -> AWAITING_REDEMPTION, and redeemPending() is what promotes the
    // bonus to BONUS_ARMED — going there directly is an illegal transition and
    // used to throw mid-reveal. The bonus spin is re-armed with Mystery Box
    // excluded from the wheel, so it can never recurse.
    mystery.close()
    bonusArmed = true
    toast('BONUS SPIN — no extra purchase needed', 'good')
    paintPublicState()
  }
}

/* --------------------------------------------------------------- redemption --- */

function redeemPending(): void {
  const pending = store.pending
  if (!pending) {
    toast('Nothing to redeem', 'info')
    return
  }
  const record: SpinRecord = {
    spinId: pending.spinId,
    timestamp: pending.createdAt,
    selectedPrizeId: pending.prizeId,
    selectedPrizeLabel: pending.prizeLabel,
    mysteryPrizeId: pending.mysteryPrizeId,
    mysteryPrizeLabel: pending.mysteryPrizeLabel,
    baseComboPrice: pending.baseComboPrice,
    finalComboPrice: pending.finalComboPrice,
    discountAmount: pending.discountAmount,
    bonusSpin: pending.bonusSpin,
    redeemed: true,
    applicationVersion: pending.applicationVersion,
    mode: pending.mode,
  }
  store.commitSpin(record)
  store.setPending(null)
  activePending = null
  revealer.close()
  mystery.close()
  dom.reveal.hidden = true

  if (bonusArmed) {
    // Rebuild the wheel without the Mystery wedge. The draw already refuses
    // mystery-box when bonusArmed is set, but leaving the wedge on screen would
    // promise a prize the bonus spin cannot deliver.
    refreshWheel({ excludeMystery: true })
    machine.go('BONUS_ARMED')
    paintPublicState()
    toast('Redeemed — bonus spin is armed', 'good')
    return
  }

  refreshWheel()
  machine.go('IDLE')
  paintPublicState()
  toast(`Redeemed — customer pays ${formatPrice(toCents(record.finalComboPrice))}`, 'good')
}

/** Apply any stock changes that arrived while a spin was in flight. */
function applyDeferredWheel(): void {
  if (!wheelDirty) return
  if (machine.state !== 'IDLE') return
  wheelDirty = false
  refreshWheel()
}

/* ----------------------------------------------------------------- recovery --- */

function buildRecovery(pending: PendingSpin): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'recovery'
  wrap.innerHTML = `
    <div class="recovery__card">
      <p class="recovery__title">RECOVERED SPIN</p>
      <p class="recovery__body">
        A prize was drawn but never confirmed. It has <strong>not</strong> been re-rolled —
        this is the exact same result. Show it to the customer, then press Redeem.
      </p>
      <p class="recovery__prize">${pending.prizeLabel}</p>
      <p class="recovery__body">
        Combo price: <strong>${formatPrice(toCents(pending.baseComboPrice))}</strong>
        &nbsp;·&nbsp; Customer pays: <strong>${formatPrice(toCents(pending.finalComboPrice))}</strong>
        ${pending.bonusSpin ? '&nbsp;·&nbsp; <em>bonus spin</em>' : ''}
        ${pending.mode === 'TEST' ? '&nbsp;·&nbsp; <em>test spin</em>' : ''}
      </p>
      <div class="recovery__actions">
        <button class="btn btn--go" data-act="resume">Reveal this prize</button>
        <button class="btn" data-act="redeem">Mark redeemed</button>
      </div>
    </div>`
  wrap.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act
    if (act === 'redeem') {
      wrap.remove()
      machine.go('AWAITING_REDEMPTION')
      redeemPending()
    }
  })
  return wrap
}

async function runRecovery(pending: PendingSpin): Promise<void> {
  machine.restore('AWAITING_REDEMPTION')
  paintPublicState()
  const card = buildRecovery(pending)
  document.body.appendChild(card)

  // Recovery honours the CURRENT wheel: a custom layout may have renamed
  // segments since the crash, but the pending prize id is still owed.
  const allNow = store.getPrizes()
  const prize = allNow.find((p) => p.id === pending.prizeId) ?? allNow.find((p) => p.label === pending.prizeLabel)
  if (!prize) {
    card.remove()
    toast('The recovered prize is no longer configured — open Settings to re-add it, then redeem', 'bad')
    return
  }
  if (!isOnWheel(prize.id)) {
    // The prize was drawn while its stock was available, so it is still owed to
    // the customer even though the wedge has since left the wheel. Honour it.
    toast(`${prize.label} is no longer on the wheel but is still being honoured`, 'info')
  }
  activePending = pending
  bonusArmed = pending.bonusSpin

  card.querySelector('[data-act="resume"]')?.addEventListener('click', async () => {
    card.remove()
    revealBusy = true
    if (isMysteryTrigger(prize) && !pending.mysteryResolved) {
      await runMystery()
    } else {
      await runReveal(prize, store.inventory)
    }
    // nextCustomer() refuses to act while revealBusy is set, so the machine must
    // still be in AWAITING_REDEMPTION here. Guard anyway: a throw at this point
    // would leave the recovered prize with no way to be redeemed.
    if (machine.state !== 'AWAITING_REDEMPTION') {
      toast('The recovered prize was already resolved', 'info')
      return
    }
    machine.go('AWAITING_REDEMPTION')
    if (pending) {
      pending.phase = 'AWAITING_REDEMPTION'
      store.setPending(pending)
    }
    paintPublicState()
  })
}

/* ------------------------------------------------------------------- input --- */

function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

dom.spinBtn.addEventListener('click', () => {
  if (spinning) return
  // First tap from IDLE arms (never spins); a tap while armed spins.
  if (machine.state === 'IDLE') {
    armSpin()
    return
  }
  if (machine.canSpin) void beginSpin()
})

dom.btnStart.addEventListener('click', () => void startEvent())
dom.preflight.testBtn.addEventListener('click', () => void runTestSpin())
dom.preflight.liveBtn.addEventListener('click', () => enterLive())
dom.staffClose.addEventListener('click', () => staff.close())

window.addEventListener('keydown', (e) => {
  // Escape always works, even from inside a text field: staff must never be
  // trapped in the staff panel because they typed in the reset box.
  if (e.key === 'Escape') {
    ;(e.target as HTMLElement | null)?.blur?.()
    if (settings.isOpen) {
      settings.close()
      staff.render()
      return
    }
    if (staff.isOpen) staff.close()
    return
  }

  // Every other shortcut is suppressed while a field has focus, so typing
  // "RESET" never arms a spin or toggles fullscreen.
  if (isTypingTarget(e.target)) return

  const k = e.key.toLowerCase()

  if (k === ' ' || e.key === 'Enter') {
    if (spinning) return
    if (machine.state === 'IDLE') {
      e.preventDefault()
      armSpin()
      return
    }
    if (machine.canSpin) {
      e.preventDefault()
      void beginSpin()
    }
    return
  }
  if (k === 'a') {
    e.preventDefault()
    armSpin()
  } else if (k === 'n') {
    e.preventDefault()
    nextCustomer()
  } else if (k === 'm') {
    toggleMute()
  } else if (k === 'f') {
    void toggleFullscreen()
  } else if (k === 's') {
    staff.toggle()
  } else if (k === 'g') {
    e.preventDefault()
    settings.isOpen ? settings.close() : openSettings()
  } else if (k === 't') {
    if (machine.state === 'IDLE' || machine.state === 'PREFLIGHT') toggleTestMode()
  }
})

// A USB arcade button that simply sends Space/Enter works with no code change.
window.addEventListener('pointerdown', () => {
  if (wakeLock !== 'active' && document.visibilityState === 'visible') void acquireWakeLock()
})

/* ------------------------------------------------------------------ startup --- */

async function startEvent(): Promise<void> {
  // A double-tap on START must not run the boot sequence twice.
  if (machine.state !== 'START') return
  // Instant feedback first: the start screen goes away on THIS frame. Sounds
  // decode in the background (21 files took ~8s even on fast wifi — blocking
  // on them made the button look dead). Preflight shows live load progress.
  dom.start.classList.remove('is-active')
  dom.start.hidden = true

  // Fullscreen synchronously, while the click gesture is still fresh.
  try {
    if (!isFullscreen()) void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  } catch {
    /* the display will just stay windowed */
  }
  void acquireWakeLock()

  // If a prize was already drawn before the reload, recovery wins over preflight.
  if (store.pending) {
    dom.stage.hidden = false
    refreshWheel()
    void bootAudio()
    await runRecovery(store.pending)
    return
  }
  openPreflight()
  void bootAudio()
}

/** Init + decode sounds without blocking the UI. Preflight re-renders live. */
async function bootAudio(): Promise<void> {
  try {
    await audio.init()
  } catch (err) {
    toast(`Audio failed to start: ${String(err)}`, 'bad')
    renderPreflightInput()
    return
  }
  audio.setMuted(store.settings.muted)
  await audio.loadAll()
  renderPreflightInput()
  staff.render()
}

function renderPreflightInput(): void {
  if (machine.state !== 'PREFLIGHT') return
  preflight.render({
    audioReady: audio.ready,
    audioLoaded: audio.loadedCount,
    audioTotal: Object.keys(sfxPaths).length,
    audioErrors: audio.loadErrors,
    storageDurable: store.durable,
    pendingSpin: store.pending ? { prizeLabel: store.pending.prizeLabel } : null,
    wakeLock,
    prizes: store.getPrizes(),
    mystery: store.getMysteryPrizes(),
  })
}

function openPreflight(): void {
  machine.restore('PREFLIGHT')
  staff.render()
  renderPreflightInput()
  // Live progress while sounds decode in the background. Stops the moment we
  // leave preflight (or the moment everything is decoded).
  const timer = setInterval(() => {
    if (machine.state !== 'PREFLIGHT' || audio.allLoaded) {
      clearInterval(timer)
      return
    }
    renderPreflightInput()
  }, 500)
}

function enterLive(): void {
  if (preflight.isBlocking) {
    toast('Fix the failing checks first', 'bad')
    return
  }
  preflight.hide()
  dom.stage.hidden = false
  dom.testWatermark.hidden = store.settings.mode !== 'TEST'

  if (store.settings.mode !== 'LIVE') store.patchSettings({ mode: 'LIVE' })

  glam.start()
  refreshWheel()

  const pending = store.pending
  if (pending) {
    void runRecovery(pending)
    return
  }
  machine.restore('IDLE')
  paintPublicState()
}

/* ------------------------------------------------------------------ a start --- */

function buildStartMark(): void {
  let pool: PrizeDefinition[]
  try {
    pool = store.getPrizes()
  } catch {
    pool = store.getPrizes()
  }
  const sectors = buildSectors(pool, 0)
  const R = 120
  const RIN = 34
  const parts: string[] = []
  const fills = [colours.cream, colours.pink, colours.red, '#E6D7B4', colours.red, colours.pink, colours.gold, colours.red]
  sectors.forEach((s, i) => {
    const large = s.sweep > 180 ? 1 : 0
    const a0 = ((s.start - 90) * Math.PI) / 180
    const a1 = ((s.end - 90) * Math.PI) / 180
    const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`
    parts.push(
      `<path d="M0 0 L${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} Z" fill="${fills[i % fills.length]}" stroke="${colours.ink}" stroke-width="2"/>`,
    )
    parts.push(
      `<path d="M0 0 L${p(RIN, a1)} A${RIN} ${RIN} 0 ${large} 0 ${p(RIN, a0)} Z" fill="${colours.ink}"/>`,
    )
  })
  parts.push(`<circle cx="0" cy="0" r="${R + 9}" fill="none" stroke="${colours.gold}" stroke-width="4"/>`)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    parts.push(`<circle cx="${(Math.cos(a) * (R + 9)).toFixed(2)}" cy="${(Math.sin(a) * (R + 9)).toFixed(2)}" r="4" fill="${colours.gold}"/>`)
  }
  parts.push(`<circle cx="0" cy="0" r="${RIN - 2}" fill="${colours.red}"/>`)
  dom.startWheelMark.innerHTML = `<svg viewBox="${-R - 24} ${-R - 24} ${(R + 24) * 2} ${(R + 24) * 2}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

function validateAtBoot(silent = false): void {
  // Validate the EFFECTIVE wheel (custom when present), not just shipped defaults.
  const issues = validateConfig({ prizes: store.getPrizes(), mystery: store.getMysteryPrizes() })
  const errors = issues.filter((i) => i.level === 'error')
  document.querySelectorAll('.recovery.recovery--config').forEach((n) => n.remove())
  if (errors.length === 0) return
  if (silent) {
    console.error('Config errors:', errors)
    toast(`Wheel config invalid: ${errors[0]!.message}`, 'bad')
    return
  }
  // Never run silently on broken rules.
  const box = document.createElement('div')
  box.className = 'recovery recovery--config'
  box.innerHTML = `
    <div class="recovery__card">
      <p class="recovery__title">CONFIGURATION ERROR</p>
      <p class="recovery__body">The wheel will not start until this is fixed. Open <strong>Wheel Settings (G)</strong> and fix the highlighted rows.</p>
      <ul class="preflight__list">${errors.map((e) => `<li class="check check--bad"><span class="check__box">✕</span><span colspan="2">${e.message}</span></li>`).join('')}</ul>
      <div class="recovery__actions"><button class="btn btn--go" data-act="fix">Open wheel settings</button></div>
    </div>`
  box.querySelector('[data-act="fix"]')?.addEventListener('click', () => {
    box.remove()
    machine.restore('IDLE')
    openSettings()
  })
  document.body.appendChild(box)
  machine.restore('ERROR_RECOVERY')
  // eslint-disable-next-line no-console
  console.error('Config errors:', errors)
}

function boot(): void {
  buildStartMark()
  validateAtBoot()

  dom.comboCard.querySelector('.combo__price')!.innerHTML = `<span class="combo__dollar">$</span>${comboPrice}`
  document.title = `${brand.name} — Prize Wheel`
  if (store.isCustomWheel) {
    console.info(`[wheel] Custom layout active (${store.getPrizes().length} segments, updated ${store.prizesUpdatedAt})`)
  }

  // Warm the textures before the first paint so nothing pops in later.
  // Relative to BASE_URL: an absolute `/assets/...` path breaks under a subpath
  // deploy (e.g. username.github.io/miguels-wheel/) with silent 404s.
  const assetBase = import.meta.env?.BASE_URL ?? './'
  for (const src of [textures.paper, textures.paperDark, textures.inkPaint, textures.grunge]) {
    const img = new Image()
    img.src = `${assetBase}${src.replace(/^\//, '')}`
  }

  machine.subscribe(() => paintPublicState())
  dom.start.classList.add('is-active')
  machine.restore('START')
  perf.start()
  if (!reducedMotion) glam.start()
  window.addEventListener('beforeunload', () => store.save())
}

boot()

/* Expose a tiny surface for automated screenshots and manual smoke checks. */
declare global {
  interface Window {
    __wheel: {
      machine: WheelMachine
      store: EventStore
      settings: typeof settings
      glam: typeof glam
      openSettings: typeof openSettings
      beginSpin: typeof beginSpin
      armSpin: typeof armSpin
      nextCustomer: typeof nextCustomer
      enterLive: typeof enterLive
      runTestSpin: typeof runTestSpin
      forcePrize: (id: string) => Promise<void>
      forceMysteryPrize: (id: string) => void
      onInventoryChange: typeof staffNotifyInventory
      startEvent: typeof startEvent
      machineState: () => State
      /** True while a spin or reveal animation is still playing. */
      isBusy: () => boolean
      rotation: () => number
      renderedSectorIds: () => string[]
      gsap: typeof gsap
      perf: PerfGuard
      config: { comboPrice: number; colours: typeof colours; textures: typeof textures }
    }
  }
}

window.__wheel = {
  machine,
  store,
  settings,
  glam,
  openSettings,
  beginSpin,
  armSpin,
  nextCustomer,
  enterLive,
  runTestSpin,
  forcePrize: (id: string) => beginSpin({ forcePrizeId: id, forcedTest: true }),
  /**
   * Force a specific Mystery Box sub-prize on the next spin. TEST mode only.
   * Needed because the bonus-spin branch is otherwise only reachable about 1%
   * of the time, which is exactly the kind of path that breaks unnoticed.
   */
  forceMysteryPrize: (id: string) => {
    if (store.settings.mode !== 'TEST') {
      toast('Force prize is only available in TEST mode', 'bad')
      return
    }
    forcedMysteryPrizeId = id
    const trigger = store.getPrizes().find((p) => isMysteryTrigger(p))?.id ?? 'mystery-box'
    void beginSpin({ forcePrizeId: trigger, forcedTest: true })
  },
  onInventoryChange: () => staffNotifyInventory(),
  startEvent,
  machineState: () => machine.state,
  /**
   * True while the wheel or a reveal animation is still playing.
   *
   * The machine state alone cannot express this: recovering from a crash puts
   * it in AWAITING_REDEMPTION for the whole resumed reveal, so a caller has no
   * way to tell "the reveal finished" from "the reveal is still playing".
   */
  isBusy: () => spinning || revealBusy,
      /** Authoritative wheel rotation, in degrees. */
      rotation: () => currentRotation,
      renderedSectorIds: () => renderedSectors.map((s) => s.id),
      gsap,
      perf,
      config: { comboPrice, colours, textures },
    }
