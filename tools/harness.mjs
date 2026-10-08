/** Shared harness: boots the built app on a real HTTP origin plus a Chromium page. */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve } from './serve.mjs'

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
export const DIST = path.join(ROOT, 'dist')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ width = 1920, height = 1080, force = false } = {}) {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    if (force) {
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      await promisify(execFile)('npx', ['vite', 'build'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 })
    } else {
      throw new Error('dist/ is missing — run `npm run build` first (or pass force: true)')
    }
  }

  const server = await serve(0) // ephemeral port
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--font-render-hinting=none',
    ],
  })
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()

  const errors = []
  page.on('pageerror', (e) => {
    errors.push(String(e.message))
    console.error('  [page error]', e.message)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push(m.text())
      console.error('  [console error]', m.text().slice(0, 400))
    }
  })

  return {
    page,
    base: server.url,
    errors,
    async close() {
      await browser.close()
      await server.close()
    },
  }
}

/** Start the event, clear storage, and land on the idle screen. */
export async function bootToIdle(page, base) {
  await page.goto(base, { waitUntil: 'load' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('#screenStart.is-active', { timeout: 20000 })
  await page.click('#btnStart')
  await page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
  await sleep(700)
  await page.click('#btnEnterLive')
  await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
  await sleep(1800)
}

/**
 * Start a forced spin WITHOUT awaiting it.
 *
 * `page.evaluate` awaits whatever the page function returns, and `forcePrize`
 * resolves only once the whole spin and reveal have finished. Returning it
 * therefore blocks for ~9 seconds and every "mid-animation" capture taken that
 * way is really the settled end state. Dropping the promise with `void` lets
 * the caller observe the animation while it runs.
 */
export async function startForcedSpin(page, prizeId) {
  await page.evaluate(() => window.__wheel.store.patchSettings({ mode: 'TEST' }))
  await page.evaluate((id) => {
    void window.__wheel.forcePrize(id)
  }, prizeId)
}

/**
 * Freeze the GSAP global timeline the first time every selector in `selectors`
 * is present and at least `opacity`. Installed as a GSAP ticker so it samples
 * every animation frame — polling from Node is far too slow to reliably land
 * inside a two-second reveal.
 */
/**
 * Freeze the GSAP timeline at a shot's peak.
 *
 * The target must be fully opaque.
 *
 * `content: true` additionally requires every [data-fx] element inside the
 * target to be lit. A prize card reaches full opacity at the end of its pop
 * tween, but the headline, PAY amount and supporting text are separate [data-fx]
 * elements that animate in after it (see #fadeInRest), so on its own the card
 * can freeze opaque and effectively empty.
 *
 * It is per-shot on purpose. The reveal cards want their content lit, but the
 * jackpot takeover peaks *before* the card finishes animating — waiting for the
 * content there lands after the gold wash has already faded, which is the
 * opposite of the shot we want. For the same reason this deliberately does NOT
 * require the ancestor chain to be opaque: the jackpot layer's own fade would
 * push the freeze past its peak.
 */
export async function freezeWhenLit(page, selectors, opacity = 0.99, { content = false } = {}) {
  await page.evaluate(
    ([sels, op, wantContent]) => {
      window.__frozen = false

      const contentLit = (n) => {
        for (const el of n.querySelectorAll('[data-fx]')) {
          if (+getComputedStyle(el).opacity < op) return false
        }
        return true
      }
      const lit = () =>
        sels.every((sel) => {
          const n = document.querySelector(sel)
          if (!n) return false
          if (+getComputedStyle(n).opacity < op) return false
          if (wantContent && !contentLit(n)) return false
          return true
        })

      const tick = function check() {
        if (window.__frozen) return
        if (!lit()) return
        window.__frozen = true
        window.__wheel.gsap.globalTimeline.pause()
      }
      // Callbacks from an earlier shot stay subscribed otherwise, and can freeze
      // a later shot on stale selectors.
      window.__thaw = () => {
        window.__wheel.gsap.ticker.remove(tick)
        window.__wheel.gsap.globalTimeline.resume()
        window.__frozen = false
      }
      window.__wheel.gsap.ticker.add(tick)
    },
    [selectors, opacity, content],
  )
}

/** Resume a timeline frozen by freezeWhenLit. */
export async function thaw(page) {
  await page.evaluate(() => {
    if (window.__thaw) window.__thaw()
    else window.__wheel.gsap.globalTimeline.resume()
  })
}

/** True once a freeze has actually happened. */
export async function isFrozen(page) {
  return page.evaluate(() => !!window.__frozen)
}
