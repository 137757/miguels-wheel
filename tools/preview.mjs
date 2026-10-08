/**
 * Visual smoke pass: capture the app at the moments that matter so a change to
 * the animation layers can be judged by eye rather than by reading code.
 *
 * Usage: node tools/preview.mjs [prizeId ...]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bootToIdle, freezeWhenLit, isFrozen, launch, sleep, startForcedSpin, thaw, ROOT } from './harness.mjs'

const OUT = path.join(ROOT, '.preview')
await mkdir(OUT, { recursive: true })

const { page, base, errors, close } = await launch()
async function shot(name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`  ✓ ${name}`)
}

await bootToIdle(page, base)
await shot('a-idle')

await page.evaluate(() => window.__wheel.armSpin())
await sleep(900)
await shot('b-armed')

await page.evaluate(() => void window.__wheel.beginSpin({ forcePrizeId: 'free-combo', forcedTest: true }))
await sleep(2200)
await shot('c-spin-fast')
await sleep(4200)
await shot('d-spin-slow')

await freezeWhenLit(page, ['.jackpot', '.prize'], 0.95)
await sleep(2600)
if (await isFrozen(page)) await shot('e-jackpot-takeover')
await thaw(page)
await sleep(900)
await freezeWhenLit(page, ['.prize'], 0.99, { content: true })
await sleep(1200)
await shot('f-jackpot-card')
await thaw(page)
await sleep(2500)
await shot('g-settled')

// A common win for the low-tier comparison.
await page.evaluate(() => window.__wheel.nextCustomer())
await sleep(600)
await startForcedSpin(page, 'free-drink')
await freezeWhenLit(page, ['.prize'], 0.99, { content: true })
await sleep(1400)
await shot('h-common')
await thaw(page)
await sleep(2000)

// Staff panel.
await page.keyboard.press('s')
await sleep(700)
await shot('i-staff')

await writeFile(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 2))
console.log(errors.length ? `ERRORS: ${errors.length}` : 'no page errors')
await close()
