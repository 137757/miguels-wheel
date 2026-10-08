// Downloads the curated Mixkit SFX set, trims leading silence, and encodes local MP3s.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const exec = promisify(execFile)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public/assets/audio')
const TMP = path.join(ROOT, '.asset-report/tmp')
const index = JSON.parse(await readFile(path.join(ROOT, '.asset-report/mixkit-index.json'), 'utf8'))
const byId = new Map(index.map((x) => [x.id, x]))

// slot -> mixkit id. Every id must exist in the scraped index.
const PICKS = {
  'arm-click': 237,
  'spin-launch': 1490,
  'button-thump': 2299,
  'win-bell': 600,
  'win-pop': 2887,
  'win-splash': 1311,
  'win-sauce': 2072,
  'win-coins': 1939,
  'cash-ding': 1935,
  'mystery-suspense': 667,
  'mystery-rumble': 685,
  'mystery-burst': 2345,
  'mystery-sparkle': 2352,
  'rare-impact': 833,
  'rare-stamp': 1743,
  'jackpot-fanfare': 2293,
  'jackpot-coins': 1999,
  'jackpot-cheer': 462,
  'jackpot-orchestra': 2285,
  'crowd-soft': 518,
  'reveal-dim': 270,
}

await mkdir(OUT, { recursive: true })
await mkdir(TMP, { recursive: true })

const manifest = []
for (const [slot, id] of Object.entries(PICKS)) {
  const meta = byId.get(String(id))
  if (!meta) {
    console.error(`MISS ${slot} -> id ${id} not in index`)
    continue
  }
  const wav = path.join(TMP, `${slot}.wav`)
  const mp3 = path.join(OUT, `${slot}.mp3`)

  // Resolve the full-quality source through the download modal.
  const modal = await exec('curl', ['-sL', '-A', UA, `https://mixkit.co/free-sound-effects/download/${id}/`], {
    maxBuffer: 8 * 1024 * 1024,
  })
  const src = modal.stdout.match(/data-download--modal-url-value="([^"]+)"/)?.[1]
  if (!src) {
    console.error(`NO SRC ${slot} ${id}`)
    continue
  }
  await exec('curl', ['-sL', '-A', UA, '-o', wav, src], { maxBuffer: 64 * 1024 * 1024 })
  const raw = await stat(wav)
  if (raw.size < 2000) {
    console.error(`TINY ${slot} ${id} ${raw.size}`)
    continue
  }
  // Normalise loudness, drop leading silence, and encode a compact local mp3.
  await exec('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', wav,
    '-af', 'silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_silence=0.02:start_threshold=-50dB,areverse,afade=t=out:st=0:d=0.15',
    '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', mp3,
  ], { maxBuffer: 16 * 1024 * 1024 })
  const out = await stat(mp3)
  manifest.push({ slot, file: `assets/audio/${slot}.mp3`, mixkitId: id, title: meta.title, source: src, bytes: out.size })
  console.log(`ok ${slot.padEnd(20)} ${String(id).padEnd(6)} ${(out.size / 1024).toFixed(0)}KB  ${meta.title}`)
}

await writeFile(path.join(ROOT, '.asset-report/audio.json'), JSON.stringify(manifest, null, 2))
await rm(TMP, { recursive: true, force: true })
console.log(`\n${manifest.length} sounds`)
