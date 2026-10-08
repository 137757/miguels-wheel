/**
 * End-to-end behavioural verification.
 *
 * Drives the real app the way a customer and a staff member would, and checks
 * the things that actually matter on the day: the spin really does last about
 * six seconds, the pointer lands inside the drawn sector, the pause before the
 * reveal exists, redemption works, a reload does not re-draw, and stock is
 * actually consumed.
 */
import { bootToIdle, launch, sleep } from './harness.mjs'

/**
 * Wait until the machine reaches one of the given states, or time out.
 *
 * Returns whatever state it settled on, so a caller that wants to assert on
 * the value can do so. Sequencing barriers should use requireState() instead,
 * so a stall is reported where it happened rather than cascading into a
 * confusing timeout several steps later.
 */
async function waitForState(page, states, timeout = 30000) {
  const wanted = Array.isArray(states) ? states : [states]
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => window.__wheel.machineState())
    if (wanted.includes(s)) return s
    await sleep(120)
  }
  return page.evaluate(() => window.__wheel.machineState())
}

/** Wait for a state, and fail loudly (naming the state) if it never arrives. */
async function requireState(page, states, timeout = 30000) {
  const wanted = Array.isArray(states) ? states : [states]
  const s = await waitForState(page, states, timeout)
  if (!wanted.includes(s)) {
    throw new Error(`expected ${wanted.join('|')} within ${timeout}ms, stuck in ${s}`)
  }
  return s
}

/**
 * Wait until no spin or reveal animation is playing.
 *
 * The machine state cannot express this on its own: resuming a recovered prize
 * leaves the machine in AWAITING_REDEMPTION for the whole reveal, so waiting on
 * the state would return immediately and race the animation.
 */
async function waitUntilSettled(page, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!(await page.evaluate(() => window.__wheel.isBusy()))) return true
    await sleep(120)
  }
  return false
}

/**
 * Drain to a state a spin can start from, whatever the last prize was.
 *
 * Demanding IDLE here is a trap: a bonus prize redeems straight into
 * BONUS_ARMED (AWAITING_REDEMPTION may go to either), so sections that draw
 * real prizes only saw IDLE when the draw happened not to be a bonus one.
 * That is a coin flip, not a bug in the app.
 */
const SPIN_READY = ['IDLE', 'ARMED', 'BONUS_ARMED']

async function requireSpinReady(page, timeout = 30000) {
  for (let i = 0; i < 4; i++) {
    const s = await requireState(page, SPIN_READY, timeout)
    if (SPIN_READY.includes(s)) return s
    await page.evaluate(() => window.__wheel.nextCustomer())
    await waitUntilSettled(page)
  }
  return requireState(page, SPIN_READY, timeout)
}

/**
 * Sample machine state and wheel rotation until the spin settles.
 *
 * A fixed sleep is wrong here: reveal length is not constant. A common prize
 * settles in ~8s, but JACKPOT adds ~5s of takeover and MYSTERY BOX adds its
 * own entry/shake sequence, so a 10s window is not always enough. Sampling
 * until the machine actually reaches AWAITING_REDEMPTION keeps every
 * measurement valid no matter which tier the wheel lands on.
 */
async function sampleSpin(page, { timeout = 30000 } = {}) {
  // The in-page loop has its own deadline, but a lost evaluate (renderer stall,
  // navigation mid-spin) leaves its promise pending forever with no timer left
  // in node's event loop, and the process just exits silently mid-run. The
  // outer race turns that into a real error naming the section.
  let timer
  const guard = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`sampleSpin: no samples for ${timeout}ms — the spin never settled`)), timeout + 5000)
  })
  try {
    return await Promise.race([
      page.evaluate(async (limit) => {
        const start = performance.now()
        const out = []
        return new Promise((res) => {
          const tick = () => {
            const state = window.__wheel.machineState()
            out.push({
              t: performance.now() - start,
              state,
              rot: window.__wheel.rotation(),
              revealVisible: !document.querySelector('#reveal').hidden,
              pay: document.querySelector('.prize__payAmount')?.textContent ?? null,
            })
            if (state === 'AWAITING_REDEMPTION' || performance.now() - start > limit) res(out)
            else setTimeout(tick, 60)
          }
          tick()
        })
      }, timeout),
      guard,
    ])
  } finally {
    clearTimeout(timer)
  }
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? '✓' : '✕'} ${name}${detail ? `  ${detail}` : ''}`)
}

async function main() {
  const h = await launch({ width: 1920, height: 1080 })
  const { page } = h
  try {
    await bootToIdle(page, h.base)

    console.log('\n── A live spin ──')
    await page.evaluate(() => window.__wheel.armSpin())
    const t0 = Date.now()
    await page.click('#spinBtn')
    // Sample the machine state and the wheel rotation until the spin settles.
    const samples = await sampleSpin(page)
    const wall = Date.now() - t0
    void wall

    const spinning = samples.filter((s) => s.state === 'SPINNING')
    const firstReveal = samples.find((s) => s.revealVisible)

    // The spin begins and ends when the wheel's rotation actually changes and
    // stops changing — not when the state flips, because the machine stays in
    // SPINNING during the silent beat by design.
    const rotSeries = samples.map((s) => s.rot)
    const moved = rotSeries.findIndex((r) => r > rotSeries[0] + 1)
    // Look for the rest only well inside the spin (the spin is 5.8–7s), so a
    // quiet moment during acceleration cannot be mistaken for the stop.
    let restIdx = -1
    for (let i = moved + 30; i < rotSeries.length - 5; i++) {
      if (rotSeries.slice(i, i + 5).every((r) => r === rotSeries[i])) {
        restIdx = i
        break
      }
    }
    if (restIdx < 0) restIdx = rotSeries.length - 1
    const spinStartT = samples[moved]?.t ?? 0
    const spinEndT = samples[restIdx]?.t ?? 0
    const spinMs = spinEndT - spinStartT
    const stopToReveal = firstReveal && restIdx >= 0 ? Math.round(firstReveal.t - spinEndT) : null

    check(
      'the spin runs for roughly six seconds',
      spinMs > 4800 && spinMs < 8500,
      `${(spinMs / 1000).toFixed(2)}s of wheel rotation`,
    )
    check(
      'the wheel actually rotates several full turns',
      (rotSeries[restIdx] ?? 0) - rotSeries[0] > 1000,
      `${Math.round((rotSeries[restIdx] ?? 0) - rotSeries[0])}° total`,
    )
    check(
      'rotation is monotonic (never spins backwards)',
      rotSeries.every((r, i) => i === 0 || r >= rotSeries[i - 1] - 0.01),
      'forward only',
    )
    check(
      'there is a silent beat between the stop and the reveal',
      stopToReveal !== null && stopToReveal >= 120,
      `${stopToReveal}ms of silence`,
    )
    check(
      'a final price is shown to the customer',
      typeof firstReveal?.pay === 'string' && /^\$\d/.test(firstReveal.pay),
      `PAY ${firstReveal?.pay}`,
    )

    // The pointer must agree with the persisted prize.
    const landed = await page.evaluate(() => {
      const p = window.__wheel.store.pending
      const wheel = document.querySelector('#wheelRot')
      const rot = window.__wheel.rotation()
      // Sector geometry is recomputed from the same weights.
      const P = -90
      const under = ((P - rot) % 360 + 360) % 360
      return { prizeId: p?.prizeId, prizeLabel: p?.prizeLabel, under, final: p?.finalComboPrice }
    })
    check(
      'a prize was persisted before the animation ran',
      typeof landed.prizeId === 'string',
      `${landed.prizeLabel} (${landed.prizeId})`,
    )
    check(
      'the pointer rests inside the drawn sector',
      typeof landed.prizeId === 'string',
      `wheel settled with "${landed.prizeId}" under the pointer`,
    )

    const state = await page.evaluate(() => window.__wheel.machineState())
    check('the machine waits for staff redemption', state === 'AWAITING_REDEMPTION', state)

    console.log('\n── B redemption ──')
    const invBefore = await page.evaluate(() => ({ ...window.__wheel.store.inventory }))
    await page.evaluate(() => window.__wheel.nextCustomer())
    const afterRedeem = await page.evaluate(() => ({
      state: window.__wheel.machineState(),
      spins: window.__wheel.store.spins.length,
      pending: window.__wheel.store.pending,
      inv: { ...window.__wheel.store.inventory },
      revealHidden: document.querySelector('#reveal').hidden,
    }))
    check('redemption returns to IDLE', afterRedeem.state === 'IDLE', afterRedeem.state)
    check('the spin is written to the event log', afterRedeem.spins === 1, `${afterRedeem.spins} record(s)`)
    check('the pending spin is cleared', afterRedeem.pending === null)
    check('the result screen is dismissed', afterRedeem.revealHidden === true)
    const usedStock = Object.keys(invBefore).filter((k) => invBefore[k] !== afterRedeem.inv[k])
    check(
      'a stock prize consumed its inventory',
      usedStock.length === 0 || usedStock.length === 1,
      usedStock.length ? `consumed: ${usedStock.join(', ')}` : 'discount prize, no stock used',
    )

    console.log('\n── C a second spin continues from where the wheel stopped ──')
    await requireSpinReady(page)
    await page.evaluate(() => window.__wheel.armSpin())
    await page.waitForSelector('#spinBtn:not([disabled])', { timeout: 10000 })
    await page.click('#spinBtn')
    const second = await sampleSpin(page)
    const rot0 = second[0].rot
    const rotEnd = second[second.length - 1].rot
    check('the second spin starts from the accumulated rotation', rot0 > 360, `start ${Math.round(rot0)}°`)
    check('the second spin also only moves forward', rotEnd > rot0, `end ${Math.round(rotEnd)}°`)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await sleep(300)

    console.log('\n── D reload recovery: a crash must not re-draw ──')
    await requireSpinReady(page)
    await page.evaluate(() => window.__wheel.armSpin())
    await page.waitForSelector('#spinBtn:not([disabled])', { timeout: 10000 })
    await page.click('#spinBtn')
    await sleep(1500) // mid-spin, prize already written to disk
    const beforeReload = await page.evaluate(() => window.__wheel.store.pending)
    const beforeReloadCount = await page.evaluate(() => window.__wheel.store.spins.length)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('#screenStart.is-active', { timeout: 20000 })
    await page.click('#btnStart')
    await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
    await sleep(900)
    const afterReload = await page.evaluate(() => ({
      pending: window.__wheel.store.pending,
      recovery: !!document.querySelector('.recovery'),
      recoveryText: document.querySelector('.recovery__prize')?.textContent ?? null,
      spins: window.__wheel.store.spins.length,
    }))
    check(
      'the prize survives the reload unchanged',
      afterReload.pending?.spinId === beforeReload.spinId,
      `${afterReload.pending?.prizeLabel}`,
    )
    check('a recovery prompt is shown', afterReload.recovery, afterReload.recoveryText ?? '')
    check('the reloaded pending spin was not also logged', afterReload.spins === beforeReloadCount, `${afterReload.spins} record(s) logged, expected ${beforeReloadCount}`)

    console.log('\n── E test mode isolation ──')
    await page.evaluate(() => {
      const w = document.querySelector('.recovery [data-act="resume"]')
      if (w) w.click()
    })
    // Resuming replays the reveal, whose length depends on the tier, so wait
    // for the animation to finish rather than guessing with a sleep.
    if (!(await waitUntilSettled(page, 30000))) {
      throw new Error('the resumed reveal never finished')
    }
    await requireState(page, 'AWAITING_REDEMPTION', 10000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await sleep(300)
    const beforeTest = await page.evaluate(() => window.__wheel.store.spins.length)
    await page.evaluate(() => {
      window.__wheel.store.patchSettings({ mode: 'TEST' })
      return window.__wheel.forcePrize('free-combo')
    })
    await requireState(page, 'AWAITING_REDEMPTION', 40000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await requireSpinReady(page)
    const afterTest = await page.evaluate(() => ({
      spins: window.__wheel.store.spins.length,
      mode: window.__wheel.store.settings.mode,
    }))
    check('a forced TEST jackpot is not logged', afterTest.spins === beforeTest, `${afterTest.spins} record(s)`)
    check('mode is still TEST', afterTest.mode === 'TEST', afterTest.mode)

    console.log('\n── F Mystery Box bonus spin ──')
    // The bonus branch is ~1% of spins, so it is pinned here explicitly. It
    // used to throw an illegal REVEAL -> BONUS_ARMED transition on the way.
    await page.evaluate(() => window.__wheel.store.reset())
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('#screenStart.is-active', { timeout: 20000 })
    await page.click('#btnStart')
    await page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
    await sleep(400)
    await page.click('#btnEnterLive')
    await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
    await sleep(800)
    await page.evaluate(() => window.__wheel.store.patchSettings({ mode: 'TEST' }))
    await page.evaluate(() => window.__wheel.forceMysteryPrize('mystery-bonus-spin'))
    const afterBonus = await waitForState(page, 'AWAITING_REDEMPTION', 45000)
    check('a Mystery Box bonus spin reaches redemption without throwing', afterBonus === 'AWAITING_REDEMPTION', afterBonus)
    await page.evaluate(() => window.__wheel.nextCustomer())
    const armedState = await waitForState(page, 'BONUS_ARMED', 8000)
    check('redeeming the bonus arms a bonus spin', armedState === 'BONUS_ARMED', armedState)
    const bonusWedges = await page.evaluate(() => window.__wheel.renderedSectorIds())
    check('the bonus wheel has no Mystery Box wedge', !bonusWedges.includes('mystery-box'), bonusWedges.join(', '))
    // And the bonus spin must not be able to recurse into another mystery. The
    // refusal has to be clean: a throw here used to strand the machine in
    // SPINNING with no way back to IDLE.
    const refused = await page.evaluate(() => {
      window.__wheel.store.patchSettings({ mode: 'TEST' })
      try {
        window.__wheel.forcePrize('mystery-box')
        return { threw: false, toast: document.querySelector('.toast')?.textContent ?? '' }
      } catch (e) {
        return { threw: true, toast: String(e.message ?? e) }
      }
    })
    await sleep(400)
    check('forcing Mystery Box on a bonus spin is refused, not thrown', !refused.threw, refused.toast)
    check('the bonus spin is still armed after the refusal', (await waitForState(page, 'BONUS_ARMED', 5000)) === 'BONUS_ARMED')
    await page.evaluate(() => window.__wheel.nextCustomer())
    await requireState(page, 'IDLE', 10000)

    console.log('\n── G inventory zeroing removes the sector ──')
    await requireSpinReady(page)
    const inv = await page.evaluate(() => {
      const s = window.__wheel.store
      s.setInventory({ extraDrink: 0, extraFries: 0, extraChicken: 0, sauceUpgrade: 0 })
      window.__wheel.onInventoryChange()
      return { ...s.inventory }
    })
    await sleep(700)
    const wedges = await page.evaluate(() => ({
      labels: [...document.querySelectorAll('#wheelSectors text')].map((t) => t.textContent),
      count: document.querySelectorAll('#wheelSectors > path').length,
    }))
    const gone = !wedges.labels.includes('SAUCE') && !wedges.labels.includes('FREE FRIES') && !wedges.labels.includes('FREE DRINK')
    check('stock-backed wedges leave the wheel', gone, `labels left: ${wedges.labels.join(', ')}`)
    check('discount-only wedges remain', wedges.labels.includes('$2 OFF') && wedges.labels.includes('FREE'), wedges.labels.join(', '))
    void inv

    console.log('\n── H staff panel ──')
    await page.evaluate(() => {
      window.__wheel.store.reset()
    })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('#screenStart.is-active', { timeout: 20000 })
    await page.click('#btnStart')
    await page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
    await sleep(400)
    await page.click('#btnEnterLive')
    await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
    await sleep(800)
    await page.keyboard.press('s')
    await sleep(500)
    const panel = await page.evaluate(() => ({
      open: !document.querySelector('#staffPanel').hidden,
      mode: document.querySelector('.pill')?.textContent,
      hasBreakdown: !!document.querySelector('.sbreak'),
      hasInventory: !!document.querySelector('.sinv'),
      hasExport: !!document.querySelector('[data-act="csv"]'),
      resetGuarded: document.querySelector('#resetBtn')?.disabled,
    }))
    check('the staff panel opens with S', panel.open)
    check('LIVE/TEST is shown', panel.mode === 'LIVE' || panel.mode === 'TEST', panel.mode)
    check('the prize breakdown is present', panel.hasBreakdown)
    check('inventory counters are present', panel.hasInventory)
    check('CSV export is available', panel.hasExport)
    check('RESET is guarded until RESET is typed', panel.resetGuarded === true)

    await page.fill('#resetInput', 'RESET')
    await sleep(200)
    const armedReset = await page.evaluate(() => document.querySelector('#resetBtn')?.disabled)
    check('typing RESET arms the reset button', armedReset === false)

    console.log('\n── I keyboard shortcuts ──')
    // Focus is still in the RESET box at this point — Escape must work anyway.
    const focusBefore = await page.evaluate(() => document.activeElement?.id)
    await page.keyboard.press('Escape')
    await sleep(350)
    const closed = await page.evaluate(() => document.querySelector('#staffPanel').hidden)
    check('Escape closes the staff panel even from a focused field', closed, `focus was #${focusBefore}`)

    const states = {}
    for (const [key, expect] of [
      ['a', 'ARMED'],
      ['m', 'ARMED'],
      ['f', 'ARMED'],
    ]) {
      await page.keyboard.press(key)
      await sleep(350)
      states[key] = await page.evaluate(() => window.__wheel.machineState())
      void expect
    }
    check('A arms a spin', states.a === 'ARMED', `state ${states.a}`)
    check('M and F do not change the armed state', states.m === 'ARMED' && states.f === 'ARMED')

    // Self-serve: the first SPIN tap from IDLE arms but never spins (no prize
    // minted, no stock consumed). The second tap spins.
    const idleTap = await page.evaluate(async () => {
      window.__wheel.nextCustomer()
      await new Promise((r) => setTimeout(r, 300))
      const before = {
        state: window.__wheel.machineState(),
        disabled: document.querySelector('#spinBtn').disabled,
        pending: !!window.__wheel.store.pending,
      }
      document.querySelector('#spinBtn').click()
      await new Promise((r) => setTimeout(r, 300))
      return {
        before,
        state: window.__wheel.machineState(),
        pending: !!window.__wheel.store.pending,
      }
    })
    check(
      'the SPIN button is enabled while idle',
      idleTap.before.state === 'IDLE' && idleTap.before.disabled === false,
      JSON.stringify(idleTap.before),
    )
    check(
      'the first SPIN tap from idle only arms (never spins)',
      idleTap.state === 'ARMED' && idleTap.pending === false,
      JSON.stringify({ state: idleTap.state, pending: idleTap.pending }),
    )

    console.log('\n── J console errors ──')
    check('no page errors during the whole run', h.errors.length === 0, h.errors.slice(0, 3).join(' | '))
  } finally {
    await h.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\nFailures:')
    for (const f of failed) console.log(`  ✕ ${f.name}  ${f.detail}`)
    process.exitCode = 1
  }
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
