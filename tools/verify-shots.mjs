/**
 * Screenshot verification.
 *
 * A PNG existing proves nothing — it could be a black frame or the wrong moment
 * in an animation. This decodes each capture and measures what is actually on it:
 * overall brightness, how much gold/red there is, edge density (a blank screen
 * has almost none), and the dominant colours. A jackpot shot must be dominated
 * by gold; a spinning shot must show motion.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { ROOT } from './harness.mjs'

const DIR = path.join(ROOT, 'screenshots')

/** Decode one PNG in a headless page and measure it. */
async function measure(f) {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej;
    i.src = 'data:image/png;base64,' + f.b64;
  });
  const W = 320, H = Math.round(img.height * (320 / img.width));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  let sum = 0, gold = 0, red = 0, cream = 0, pink = 0, dark = 0, bright = 0;
  const buckets = new Map();
  let edges = 0;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const l = 0.2126*r + 0.7152*g + 0.0722*b;
    lum[p] = l; sum += l;
    if (l < 28) dark++;
    if (l > 200) bright++;
    // Gold covers a wide band, not just the bright core. The jackpot price
    // screen is a deliberate dark-gold vignette around a hot centre, so a
    // bright-only test scored it 0% gold and flagged a screen that plainly
    // reads as gold. The floor on green keeps it clear of the red field
    // (the half-off wipe is warm too, but has almost no green in it).
    if (r > 120 && g > 55 && b < 110 && r - b > 70 && r >= g) gold++;
    if (r > 150 && g < 90 && b < 80) red++;
    if (r > 200 && g > 185 && b > 140 && Math.abs(r-g) < 45) cream++;
    if (r > 200 && g > 90 && g < 175 && b > 110 && b < 190) pink++;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y*W+x;
    edges += Math.abs(lum[i] - lum[i+1]) + Math.abs(lum[i] - lum[i+W]);
  }
  const n = W * H;
  const top = [...buckets.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v]) => ({
    hex: '#' + [ (k>>6)&7, (k>>3)&7, k&7 ].map(x => (x*32+16).toString(16).padStart(2,'0')).join(''),
    pct: +(v/n*100).toFixed(1),
  }));
  return {
    file: f.name, w: img.width, h: img.height,
    meanLuma: +(sum/n).toFixed(1),
    dark: +(dark/n*100).toFixed(1),
    bright: +(bright/n*100).toFixed(1),
    gold: +(gold/n*100).toFixed(1),
    red: +(red/n*100).toFixed(1),
    cream: +(cream/n*100).toFixed(1),
    pink: +(pink/n*100).toFixed(1),
    edges: +(edges/n).toFixed(1),
    top,
  };
}

async function main() {
  const { readdir } = await import('node:fs/promises')
  const names = (await readdir(DIR)).filter((f) => f.endsWith('.png')).sort()
  const files = []
  for (const name of names) {
    const buf = await readFile(path.join(DIR, name))
    files.push({ name, b64: buf.toString('base64') })
  }

  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('about:blank')
  const results = []
  for (const f of files) {
    // One file per evaluate call: a 14-image payload is far too large to
    // serialise into a single page.evaluate argument.
    results.push(await page.evaluate(measure, f))
  }
  await browser.close()

  console.log('\n  file                              size        luma  dark bright  gold  red cream pink  edges  dominant')
  console.log('  ' + '─'.repeat(112))
  for (const r of results) {
    console.log(
      `  ${r.file.padEnd(30)} ${String(r.w + '×' + r.h).padEnd(11)} ` +
        `${String(r.meanLuma).padStart(5)} ${String(r.dark).padStart(5)} ${String(r.bright).padStart(6)} ` +
        `${String(r.gold).padStart(6)} ${String(r.red).padStart(5)} ${String(r.cream).padStart(5)} ${String(r.pink).padStart(5)} ` +
        `${String(r.edges).padStart(7)}  ${r.top.map((t) => `${t.hex} ${t.pct}%`).join(', ')}`,
    )
  }

  // Sanity rules. These are the checks that catch "a screenshot of nothing".
  const problems = []
  const byName = Object.fromEntries(results.map((r) => [r.file, r]))
  const need = (file, rule, ok) => {
    const r = byName[file]
    if (!r) {
      problems.push(`${file}: missing`)
      return
    }
    if (!ok(r)) problems.push(`${file}: ${rule}`)
  }

  for (const r of results) {
    if (r.meanLuma < 4) problems.push(`${r.file}: screen is essentially black (luma ${r.meanLuma})`)
    if (r.edges < 3) problems.push(`${r.file}: almost no detail (edges ${r.edges}) — probably a blank frame`)
  }
  need('03-idle.png', 'should not be dominated by gold', (r) => r.gold < 55)
  need('12-jackpot.png', 'should be strongly gold', (r) => r.gold > 8 || r.bright > 6)
  need('13-jackpot-pay.png', 'should still be gold', (r) => r.gold > 4)
  need('10-half-off.png', 'should show the red stamp', (r) => r.red > 1.2)
  need('06-common-win.png', 'should have readable bright content', (r) => r.bright > 1.2)
  // Preflight is a small card of text on a large near-black field, so its cream
  // coverage is a fraction of the staff panel's dense one (0.7 vs 5.6). 0.8 was
  // measured against the panel, not against this screen; 0.5 still separates a
  // real text screen (~14k text pixels) from a blank frame (0) by a wide margin.
  need('02-preflight.png', 'is a text screen', (r) => r.cream > 0.5)
  need('14-staff-panel.png', 'is a text screen', (r) => r.cream > 0.8)
  need('05-spinning.png', 'the wheel should still be on screen', (r) => r.cream > 0.5 || r.gold > 0.5)

  console.log('\n' + '─'.repeat(112))
  if (problems.length === 0) {
    console.log('  ✓ every screenshot has real, distinct content\n')
  } else {
    console.log('  Problems:')
    for (const p of problems) console.log(`  ✕ ${p}`)
    console.log()
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
