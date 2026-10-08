/**
 * Frame-cost attribution.
 *
 * Disables one visual layer at a time and measures the resulting frame rate, so
 * the expensive things are found by measurement rather than guesswork.
 */
import { bootToIdle, launch, sleep } from './harness.mjs'

const CANDIDATES = [
  ['baseline (everything on)', () => {}],
  [
    'no texture layers',
    () => {
      document.querySelectorAll('.tex').forEach((n) => (n.style.display = 'none'))
    },
  ],
  [
    'no ink/grunge blend layers',
    () => {
      for (const s of ['.tex--ink', '.tex--grunge']) {
        const n = document.querySelector(s)
        if (n) n.style.display = 'none'
      }
    },
  ],
  [
    'no lantern glow',
    () => {
      const n = document.querySelector('.lantern-glow')
      if (n) n.style.display = 'none'
    },
  ],
  [
    'no wheel rays',
    () => {
      const n = document.querySelector('#wheelRays')
      if (n) n.style.display = 'none'
    },
  ],
  [
    'no petals',
    () => {
      const n = document.querySelector('#petals')
      if (n) n.style.display = 'none'
    },
  ],
  [
    'no marquee bulbs',
    () => {
      document.querySelectorAll('.bulb').forEach((n) => (n.style.display = 'none'))
    },
  ],
  [
    'no wheel sector grain overlays',
    () => {
      document.querySelectorAll('#wheelSectors path').forEach((p, i) => {
        if (p.getAttribute('style')?.includes('multiply')) p.style.display = 'none'
        void i
      })
    },
  ],
  [
    'no wheel drop-shadow filter',
    () => {
      const n = document.querySelector('#wheelSvg')
      if (n) n.style.filter = 'none'
    },
  ],
  [
    'no pointer drop-shadow',
    () => {
      const n = document.querySelector('#pointer')
      if (n) n.style.filter = 'none'
    },
  ],
  [
    'no icon SVGs in sectors',
    () => {
      document.querySelectorAll('#wheelSectors .icon-svg').forEach((n) => (n.style.display = 'none'))
    },
  ],
  [
    'wheel hidden entirely',
    () => {
      const n = document.querySelector('#wheelMount')
      if (n) n.style.visibility = 'hidden'
    },
  ],
]

async function fps(page) {
  return page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0
        const t0 = performance.now()
        const f = () => {
          n++
          if (performance.now() - t0 < 2200) requestAnimationFrame(f)
          else res(n / ((performance.now() - t0) / 1000))
        }
        requestAnimationFrame(f)
      }),
  )
}

async function main() {
  const h = await launch({ width: 1920, height: 1080 })
  const { page } = h
  try {
    await bootToIdle(page, h.base)
    console.log('\nFrame rate with one layer disabled at a time (1920×1080, software rendering)\n')
    const results = []
    for (const [label, fn] of CANDIDATES) {
      await fn2(page, fn)
      const f = await fps(page)
      results.push([label, f])
      console.log(`  ${label.padEnd(34)} ${f.toFixed(1).padStart(6)} fps`)
    }
    const base = results[0][1]
    console.log('\nImpact of each layer:')
    for (const [label, f] of results.slice(1)) {
      const gain = ((base - f) / base) * 100
      console.log(`  ${label.padEnd(34)} ${gain > 1 ? `+${gain.toFixed(0)}% faster` : '—'}`)
    }
  } finally {
    await h.close()
  }
  console.log()
}

async function fn2(page, fn) {
  const src = `(${fn.toString()})()`
  await page.evaluate(src)
  await sleep(300)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
