// Downloads Google Fonts as self-hosted woff2 so the app needs no network at runtime.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const exec = promisify(execFile)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const ROOT = path.resolve(import.meta.dirname, '..')
const FONT_DIR = path.join(ROOT, 'public/assets/fonts')

// family -> axis/weight spec
const FAMILIES = [
  { css: 'Bungee', file: 'bungee-400' },
  { css: 'Anton', file: 'anton-400' },
  { css: 'Barlow+Condensed:wght@500;600;700;800;900', file: 'barlow-condensed' },
]

await mkdir(FONT_DIR, { recursive: true })
const url =
  'https://fonts.googleapis.com/css2?' +
  FAMILIES.map((f) => `family=${f.css}`).join('&') +
  '&display=swap'

const { stdout: css } = await exec('curl', ['-sL', '-A', UA, url], { maxBuffer: 4 * 1024 * 1024 })

// Keep only latin subsets to stay small.
const blocks = css.split('/*').filter(Boolean)
const out = []
const seen = new Set()
for (const raw of blocks) {
  const block = '/*' + raw
  const subset = block.match(/\/\*\s*([a-z-]+)\s*\*\//)?.[1]
  if (subset !== 'latin') continue
  const fam = block.match(/font-family:\s*'([^']+)'/)?.[1]
  const wght = block.match(/font-weight:\s*(\d+)/)?.[1] ?? '400'
  const style = block.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal'
  const src = block.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1]
  if (!src) continue
  const name = `${fam.toLowerCase().replace(/\s+/g, '-')}-${wght}.woff2`
  if (seen.has(name)) continue
  seen.add(name)
  await exec('curl', ['-sL', '-A', UA, '-o', path.join(FONT_DIR, name), src], {
    maxBuffer: 16 * 1024 * 1024,
  })
  out.push({ name, family: fam, weight: wght, style, src })
  console.log('ok', name, fam, wght)
}

await writeFile(path.join(ROOT, '.asset-report/fonts.json'), JSON.stringify(out, null, 2))
console.log(`${out.length} font files`)
