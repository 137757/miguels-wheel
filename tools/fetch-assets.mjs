// Asset acquisition helper. Probes candidate URLs and downloads whatever resolves.
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function head(url) {
  try {
    const r = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (!r.ok) return { ok: false, status: r.status, url }
    const buf = Buffer.from(await r.arrayBuffer())
    return { ok: true, status: r.status, url: r.url, buf, type: r.headers.get('content-type') }
  } catch (e) {
    return { ok: false, status: 0, url, err: String(e) }
  }
}

export async function grab(relPath, urls, { minBytes = 4000 } = {}) {
  const dest = path.join(ROOT, 'public', relPath)
  if (existsSync(dest)) {
    const s = await stat(dest)
    if (s.size > minBytes) return { relPath, ok: true, cached: true, size: s.size }
  }
  await mkdir(path.dirname(dest), { recursive: true })
  for (const u of urls) {
    const r = await head(u)
    if (r.ok && r.buf.length > minBytes && (r.type === null || /image|audio|font|octet|video/.test(r.type))) {
      await writeFile(dest, r.buf)
      return { relPath, ok: true, size: r.buf.length, from: r.url, type: r.type }
    }
  }
  return { relPath, ok: false, tried: urls }
}
