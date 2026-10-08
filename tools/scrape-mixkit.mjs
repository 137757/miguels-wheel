// Scrapes Mixkit free sound-effect category pages and resolves full-quality asset URLs.
// Usage: node tools/scrape-mixkit.mjs <category> [category...]
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const exec = promisify(execFile)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export async function get(url) {
  const { stdout } = await exec('curl', ['-sL', '-A', UA, url], { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

const CATEGORIES = process.argv.slice(2)

const all = []
for (const cat of CATEGORIES) {
  const html = await get(`https://mixkit.co/free-sound-effects/${cat}/`)
  // Titles: pull the human label rendered on the card.
  const titles = [...html.matchAll(/item-grid-card__title[^>]*>([^<]{2,90})</g)].map((m) => m[1].trim())
  // Cards are emitted in document order: download-modal path first, then the audio player.
  const downloads = [...html.matchAll(/data-download--button-modal-url-value="\/free-sound-effects\/download\/(\d+)\/"/g)].map(
    (m) => m[1],
  )
  const previews = [
    ...html.matchAll(/data-audio-player-preview-url-value="(https:\/\/assets\.mixkit\.co\/[^"]+)"/g),
  ].map((m) => m[1])
  const found = previews.map((preview, i) => {
    const id = preview.match(/sfx\/(\d+)\//)?.[1] ?? null
    return { category: cat, preview, id, downloadId: downloads[i] ?? null, title: titles[i] ?? null }
  })
  all.push(...found)
  console.error(`${cat}: ${found.length} items`)
}

await mkdir(path.resolve(import.meta.dirname, '../.asset-report'), { recursive: true })
await writeFile(
  path.resolve(import.meta.dirname, '../.asset-report/mixkit-index.json'),
  JSON.stringify(all, null, 2),
)
console.log(JSON.stringify(all.slice(0, 12), null, 2))
