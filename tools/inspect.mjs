/**
 * Visual diagnostic.
 *
 * Measures the real rendered layout in Chromium and reports anything that would
 * hurt readability from three metres away: contrast of the key readouts against
 * the actual background, the wheel's share of the screen, sector label fit,
 * overflow, and whether anything is clipped at 1366×768.
 */
import { bootToIdle, launch, sleep } from './harness.mjs'

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
const parse = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)

const PROBES = [
  ['#spinBtn .spinbtn__label', 'SPIN button label'],
  ['.combo__price', 'combo price'],
  ['.cta', 'CTA line'],
  ['.promo__text', 'promo line'],
  ['.brand__word', 'wordmark'],
  ['.combo__items li', 'combo item list'],
  ['.brand__sub', 'brand subline'],
]

async function probeSizes(page) {
  return page.evaluate((probes) => {
    const out = []
    for (const [sel, name] of probes) {
      const n = document.querySelector(sel)
      if (!n) {
        out.push({ name, missing: true })
        continue
      }
      const cs = getComputedStyle(n)
      const r = n.getBoundingClientRect()
      out.push({
        name,
        fontSize: parseFloat(cs.fontSize),
        family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        color: cs.color,
        width: Math.round(r.width),
        x: Math.round(r.x),
        y: Math.round(r.y),
      })
    }
    return out
  }, PROBES)
}

async function layout(page) {
  return page.evaluate(() => {
    const box = (sel) => {
      const n = document.querySelector(sel)
      if (!n) return null
      const r = n.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const stage = box('#stage')
    const brand = box('.brand')
    const wheel = box('#wheelSvg')
    const texts = [...document.querySelectorAll('#wheelSectors text')].map((t) => {
      const r = t.getBoundingClientRect()
      return {
        text: t.textContent,
        font: t.getAttribute('font-size'),
        w: Math.round(r.width),
        h: Math.round(r.height),
        cx: Math.round(r.x + r.width / 2),
        cy: Math.round(r.y + r.height / 2),
      }
    })
    return {
      stage,
      brand,
      wheel,
      rig: box('.rig'),
      spinBtn: box('#spinBtn'),
      combo: box('.combo'),
      mascot: box('.mascot'),
      petals: document.querySelectorAll('.petal').length,
      bulbs: document.querySelectorAll('.bulb').length,
      sectorPaths: document.querySelectorAll('#wheelSectors path').length,
      marqueeOn: [...document.querySelectorAll('.bulb')].filter((b) => !b.classList.contains('is-dim')).length,
      texts,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }
  })
}

function reportComposition(d, label) {
  const pctW = (v) => `${((v / d.vw) * 100).toFixed(1)}%`
  console.log(`\n── ${label} (${d.vw}×${d.vh}) ──`)
  console.log(`  brand column   ${pctW(d.brand.w).padStart(7)} of width   (target 35–40%)`)
  console.log(`  wheel column   ${pctW(d.rig.w).padStart(7)} of width   (target 60–65%)`)
  console.log(`  wheel diameter ${String(d.wheel.w).padStart(7)}px = ${((d.wheel.w / d.vh) * 100).toFixed(1)}% of screen height`)
  console.log(`  spin button    ${d.spinBtn.w}×${d.spinBtn.h}  (${((d.spinBtn.w / d.vw) * 100).toFixed(1)}% wide)`)
  console.log(`  sectors drawn  ${d.sectorPaths} paths · ${d.texts.length} labels · ${d.bulbs} bulbs (${d.marqueeOn} lit) · ${d.petals} petals`)
  console.log(`  overflow       x=${d.overflowX} y=${d.overflowY} ${d.overflowX > 0 || d.overflowY > 0 ? '  ⚠ PAGE SCROLLS' : ' ✓ none'}`)
  if (d.mascot && d.mascot.w > 0) {
    console.log(`  mascot         ${d.mascot.w}×${d.mascot.h} at ${d.mascot.x},${d.mascot.y}`)
  }
}

function reportLabels(d) {
  console.log(`  sector labels:`)
  const fits = []
  for (const t of d.texts) {
    // A label is "safe" if it stays inside the wheel disc.
    const dx = t.cx - (d.wheel.x + d.wheel.w / 2)
    const dy = t.cy - (d.wheel.y + d.wheel.h / 2)
    const dist = Math.hypot(dx, dy)
    const inside = dist <= d.wheel.w / 2 - 6
    fits.push(inside)
    console.log(
      `    ${String(t.text).padEnd(15)} ${String(t.font).padStart(3)}px  ${String(t.w).padStart(4)}px wide  r=${Math.round(dist)}  ${inside ? '✓' : '⚠ OUTSIDE'}`,
    )
  }
  if (d.texts.length && fits.every(Boolean)) console.log('    ✓ every label sits inside the rim')
}

async function main() {
  const h = await launch({ width: 1920, height: 1080 })
  const { page, base, errors } = h
  try {
    await page.goto(base, { waitUntil: 'load' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('#screenStart.is-active', { timeout: 20000 })
    await sleep(1200)

    const start = await page.evaluate(() => {
      const r = (s) => {
        const n = document.querySelector(s)
        if (!n) return null
        const b = n.getBoundingClientRect()
        return { w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y) }
      }
      return {
        title: r('.start__title'),
        mark: r('.start__wheel-mark'),
        btn: r('.btn-start'),
        overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }
    })
    console.log(`\n── START (1920×1080) ──`)
    console.log(`  title ${start.title.w}×${start.title.h} · wheel mark ${start.mark.w}px · button ${start.btn.w}×${start.btn.h}`)
    console.log(`  overflow ${start.overflowY === 0 ? '✓ none' : '⚠ ' + start.overflowY}`)

    await page.click('#btnStart')
    await page.waitForSelector('#screenPreflight:not([hidden])', { timeout: 20000 })
    await sleep(700)
    const pf = await page.evaluate(() =>
      [...document.querySelectorAll('.check')].map((n) => ({
        label: n.children[1]?.textContent,
        status: n.className.replace('check check--', ''),
        detail: n.children[2]?.textContent,
      })),
    )
    console.log(`\n── PREFLIGHT ──`)
    for (const c of pf) {
      const icon = { ok: '✓', warn: '!', bad: '✕' }[c.status] ?? '?'
      console.log(`  ${icon} ${String(c.label).padEnd(32)} ${c.detail}`)
    }
    const liveBtn = await page.evaluate(() => document.querySelector('#btnEnterLive')?.disabled)
    console.log(`  ENTER LIVE MODE disabled: ${liveBtn ? 'YES ⚠' : 'no ✓'}`)

    await page.click('#btnEnterLive')
    await page.waitForSelector('#stage:not([hidden])', { timeout: 20000 })
    await sleep(2000)

    const idle = await layout(page)
    reportComposition(idle, 'IDLE 1920×1080')
    reportLabels(idle)

    const sizes = await probeSizes(page)
    console.log(`\n── TYPE (readable from 3–5 m) ──`)
    const bg = parse(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    for (const s of sizes) {
      if (s.missing) {
        console.log(`  ${s.name.padEnd(18)} ⚠ missing`)
        continue
      }
      const px = s.fontSize
      const verdict = px >= 40 ? '✓ huge' : px >= 26 ? '✓ large' : px >= 18 ? '· small' : '⚠ too small'
      const cr = contrast(parse(s.color), bg)
      console.log(
        `  ${s.name.padEnd(18)} ${String(Math.round(px)).padStart(3)}px  ${s.family.padEnd(18)} ${cr.toFixed(1)}:1  ${verdict}`,
      )
    }

    // Armed state
    await page.evaluate(() => window.__wheel.armSpin())
    await sleep(1300)
    const armed = await page.evaluate(() => ({
      state: window.__wheel.machineState(),
      cueVisible: !document.querySelector('#turnCue').hidden,
      spinEnabled: !document.querySelector('#spinBtn').disabled,
      level: document.querySelector('#stage').dataset.armed,
    }))
    console.log(`\n── ARMED ──`)
    console.log(`  ${JSON.stringify(armed)}`)
    const armedLayout = await layout(page)
    console.log(`  wheel grows to ${armedLayout.wheel.w}px (${(armedLayout.wheel.w / idle.wheel.w).toFixed(3)}× idle)`)

    // 1366x768 — the minimum display we promise to support.
    const small = await launch({ width: 1366, height: 768 })
    try {
      await bootToIdle(small.page, small.base)
      const s = await layout(small.page)
      reportComposition(s, 'IDLE 1366×768')
      const ss = await probeSizes(small.page)
      const tiny = ss.filter((x) => !x.missing && x.fontSize < 18)
      console.log(`  text below 18px at 1366: ${tiny.length === 0 ? 'none ✓' : tiny.map((t) => t.name).join(', ')}`)
    } finally {
      await small.close()
    }

    console.log(`\n── ERRORS ──`)
    console.log(errors.length === 0 ? '  none ✓' : errors.map((e) => `  ⚠ ${e}`).join('\n'))
  } finally {
    await h.close()
  }
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
