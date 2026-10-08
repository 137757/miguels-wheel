/**
 * Screenshot capture.
 *
 * Drives the real application through every state the brief asks for and writes
 * a PNG of each. States are reached through the same code paths staff and
 * customers use — the only exception is forcing a specific prize, which is
 * deliberately TEST-mode-only and exists for exactly this purpose.
 *
 * Two things make this reliable, and both were learned the hard way:
 *
 *  1. A forced spin must be started with `void`, not awaited. `forcePrize`
 *     resolves only after the whole spin and reveal, and `page.evaluate`
 *     awaits whatever the page function returns — so returning it blocks for
 *     nine seconds and every "mid-animation" shot is really the settled state.
 *
 *  2. Each reveal is captured by FREEZING the GSAP timeline the moment its
 *     signature elements are fully lit, rather than sleeping and hoping. The
 *     jackpot takeover is only about two seconds wide and the 50% OFF stamp
 *     barely 700ms; polling from Node cannot reliably land inside either.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  freezeWhenLit,
  isFrozen,
  launch,
  sleep,
  startForcedSpin,
  thaw,
  ROOT,
} from './harness.mjs'

const OUT = path.join(ROOT, 'screenshots')

const shots = []
async function shot(page, name, note) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  shots.push({ name, note })
  console.log(`  ✓ ${name}.png — ${note}`)
}

async function waitForState(page, states, timeout = 40000) {
  const wanted = Array.isArray(states) ? states : [states]
  const deadline = Date.now() + timeout
  let s = ''
  while (Date.now() < deadline) {
    s = await page.evaluate(() => window.__wheel.machineState())
    if (wanted.includes(s)) return s
    await sleep(100)
  }
  return s
}

/**
 * Freeze the reveal at its peak, capture, then let it finish. Reports whether
 * the freeze actually landed, so a silently missed window cannot pass as a
 * good screenshot.
 */
async function shotAtPeak(page, selectors, name, note, settleMs = 120, opts = {}) {
  await freezeWhenLit(page, selectors, 0.99, opts)
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (await isFrozen(page)) break
    await sleep(80)
  }
  if (!(await isFrozen(page))) {
    console.log(`  ⚠ ${name}: never reached the lit state for ${selectors.join(', ')}`)
  }
  await sleep(settleMs)
  await shot(page, name, note)
  await thaw(page)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const h = await launch({ width: 1920, height: 1080 })
  const { page } = h

  try {
    console.log('\nCapturing at 1920×1080\n')

    // ---- 0. event start ---------------------------------------------------
    await page.goto(h.base, { waitUntil: 'load' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('#screenStart.is-active', { timeout: 20000 })
    await sleep(1500)
    await shot(page, '01-start', 'Event start screen — staff click unlocks audio and fullscreen')

    // ---- 1. preflight -----------------------------------------------------
    await page.click('#btnStart')
    await page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
    await sleep(900)
    await shot(page, '02-preflight', 'Staff preflight diagnostics before the students arrive')

    // ---- 2. idle ----------------------------------------------------------
    await page.click('#btnEnterLive')
    await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
    await sleep(2600)
    await shot(page, '03-idle', 'Idle attract screen — 37% brand, 63% wheel')

    // ---- 3. armed ---------------------------------------------------------
    await page.evaluate(() => window.__wheel.armSpin())
    await sleep(1500)
    await shot(page, '04-armed', 'Armed — waiting for the customer to hit SPIN')

    // ---- 4. spinning ------------------------------------------------------
    await page.click('#spinBtn')
    await waitForState(page, 'SPINNING')
    await sleep(2600)
    await shot(page, '05-spinning', 'Mid-spin — the high-speed phase')

    // ---- 5. a common win --------------------------------------------------
    await shotAtPeak(page, ['.reveal .prize'], '06-common-win', 'Reveal — a common prize, with the price to pay', 400, { content: true })
    await waitForState(page, 'AWAITING_REDEMPTION', 20000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await waitForState(page, 'IDLE')

    // ---- 6. the $2 OFF slam -----------------------------------------------
    // MID is 24% of every spin and had no capture at all, so the second most
    // common thing a customer can win was the only tier nobody could look at.
    await startForcedSpin(page, 'two-off')
    await shotAtPeak(page, ['.reveal.is-mid .prize'], '07-mid-two-off', 'MID — the $2 OFF slam, with the price to pay', 400, { content: true })
    await waitForState(page, 'AWAITING_REDEMPTION', 20000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await waitForState(page, 'IDLE')

    // ---- 7. mystery box ---------------------------------------------------
    await startForcedSpin(page, 'mystery-box')
    // The box enters, shakes, pauses, then bursts. Catch it at full opacity
    // during the shake, before the lid comes off.
    await shotAtPeak(page, ['.mystery__box'], '08-mystery-box', 'Mystery Box — entering and shaking', 500)
    // ...and the sub-prize it turns out to be holding.
    await shotAtPeak(page, ['.mystery__result'], '09-mystery-prize', 'Mystery Box — the sub-prize revealed', 500)
    await waitForState(page, 'AWAITING_REDEMPTION', 30000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await waitForState(page, 'IDLE')

    // ---- 8. 50% off -------------------------------------------------------
    await startForcedSpin(page, 'half-off')
    // The stamp is on screen for well under a second; freeze on it.
    await shotAtPeak(page, ['.halfprice__stamp'], '10-half-off', 'RARE — the 50% OFF stamp', 200)
    // The price lands after the stamp, still on the red field. `content: true`
    // is required here for the same reason as 06: the card box reaches full
    // opacity before the PAY row fades in, so without it the capture is a
    // correctly-lit but empty red field and the shot does not show the number
    // its own caption promises.
    await shotAtPeak(page, ['.reveal.is-rare .prize'], '11-half-off-pay', 'RARE — PAY $7.50', 350, { content: true })
    await waitForState(page, 'AWAITING_REDEMPTION', 30000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await waitForState(page, 'IDLE')

    // ---- 9. jackpot -------------------------------------------------------
    await startForcedSpin(page, 'free-combo')
    // The takeover: the gold wash and the giant FREE COMBO, both fully lit and
    // before the PAY $0 row is added.
    await shotAtPeak(page, ['.jackpot-layer__wash', '.jackpot-layer__free'], '12-jackpot', 'JACKPOT — gold takeover and confetti', 300)
    // Then the price, which the jackpot layer holds until staff redeems.
    await shotAtPeak(page, ['.jackpot-layer .prize'], '13-jackpot-pay', 'JACKPOT — PAY $0', 400)
    await waitForState(page, 'AWAITING_REDEMPTION', 30000)
    await page.evaluate(() => window.__wheel.nextCustomer())
    await waitForState(page, 'IDLE')

    // ---- 10. staff panel -------------------------------------------------
    await page.evaluate(() => window.__wheel.armSpin())
    await sleep(500)
    await page.keyboard.press('s')
    await sleep(900)
    await shot(page, '14-staff-panel', 'Staff panel — live stats, inventory, export and reset')
    await page.keyboard.press('Escape')
    await sleep(400)

    // ---- 11. minimum supported display ------------------------------------
    await h.close()
    const small = await launch({ width: 1366, height: 768 })
    try {
      await small.page.goto(small.base, { waitUntil: 'load' })
      await sleep(1500)
      await small.page.click('#btnStart')
      await small.page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
      await small.page.click('#btnEnterLive')
      await small.page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
      await sleep(2200)
      await shot(small.page, '15-idle-1366x768', 'The same screen at 1366×768, the minimum supported display')
    } finally {
      await small.close()
    }

    // ---- 12. narrow / stacked layout --------------------------------------
    // Below 1000px the stage drops to one column and the wheel sits under the
    // brand block. That layout had no capture at all, which meant a whole
    // breakpoint shipped unverified.
    const narrow = await launch({ width: 900, height: 1000 })
    try {
      await narrow.page.goto(narrow.base, { waitUntil: 'load' })
      await sleep(1500)
      await narrow.page.click('#btnStart')
      await narrow.page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
      await narrow.page.click('#btnEnterLive')
      await narrow.page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
      await sleep(2200)
      await shot(narrow.page, '16-idle-900-stacked', 'The single-column fallback at 900px — the wheel drops below the brand block')
    } finally {
      await narrow.close()
    }

    await writeFile(
      path.join(OUT, 'README.md'),
      `# Screenshots\n\nCaptured from the production build of the real application, driven\nthrough the same code paths staff and customers use. Each reveal is captured\nby freezing the animation at its peak rather than sleeping and hoping.\n\n${shots
        .map((s, i) => `${String(i + 1).padStart(2, '0')}. **${s.name}.png** — ${s.note}`)
        .join('\n')}\n`,
    )
    console.log(`\n${shots.length} screenshots written to ${OUT}\n`)
    if (h.errors.length) {
      console.log('Browser errors seen:')
      for (const e of h.errors) console.log(`  ⚠ ${e}`)
    }
  } finally {
    await h.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
