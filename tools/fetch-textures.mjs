// Scrapes each texturelabs texture page for its canonical full-size asset URL, then downloads.
import { grab } from './fetch-assets.mjs'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const SLUGS = [
  ['assets/textures/paper_269.jpg', 'paper_269', 'Paper 269'],
  ['assets/textures/paper_183.jpg', 'paper_183', 'Paper 183'],
  ['assets/textures/inkpaint_306.jpg', 'inkpaint_306', 'InkPaint 306'],
  ['assets/textures/grunge_336.jpg', 'grunge_336', 'Grunge 336'],
]

const report = []
for (const [rel, slug, name] of SLUGS) {
  const page = await fetch(`https://texturelabs.org/textures/${slug}/`, {
    headers: { 'User-Agent': UA },
  })
  const html = await page.text()
  const candidates = new Set()
  for (const m of html.matchAll(/https:\/\/texturelabs\.org\/wp-content\/uploads\/[^"' )]+\.(?:jpg|png|jpeg)/gi)) {
    const u = m[0]
    if (/-\d{3}S\.jpg$/i.test(u)) continue // skip the small thumbnail
    if (new RegExp(`${slug.split('_')[0]}_${slug.split('_')[1]}$`, 'i').test(u)) candidates.add(u)
  }
  // broaden: any non-thumbnail upload that contains the resource code
  const code = name.replace(/\s+/g, '')
  for (const m of html.matchAll(/https:\/\/texturelabs\.org\/wp-content\/uploads\/[^"' )]+\.(?:jpg|png|jpeg)/gi)) {
    const u = m[0]
    if (/-\d{3}S\.jpg$/i.test(u)) continue
    if (u.toLowerCase().includes(code.toLowerCase())) candidates.add(u)
  }
  const urls = [...candidates]
  const r = await grab(rel, urls, { minBytes: 20000 })
  report.push({ ...r, resource: name, slug, candidates: urls })
  console.log(JSON.stringify(report.at(-1)))
}
await mkdir(path.resolve(import.meta.dirname, '../.asset-report'), { recursive: true })
await writeFile(
  path.resolve(import.meta.dirname, '../.asset-report/textures.json'),
  JSON.stringify(report, null, 2),
)
