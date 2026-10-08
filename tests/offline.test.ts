/**
 * Offline guarantee: requirement 14.
 *
 * Market Day internet is bad at best. These tests assert the *built* artefact
 * contains no remote references of any kind, so the app keeps working after the
 * network is unplugged.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sfxPaths, textures } from '../src/config/eventConfig.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIST = path.join(ROOT, 'dist')

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function distFiles(): string[] {
  return walk(DIST)
}

/** Text-ish files we can safely scan for remote references. */
function scannable(files: string[]): string[] {
  return files.filter((f) => /\.(html|css|js|json|svg|txt|md)$/.test(f))
}

describe('14 — the production build works without a network', () => {
  const built = existsSync(DIST)

  it.skipIf(!built)('the dist folder exists and contains an index.html', () => {
    expect(existsSync(path.join(DIST, 'index.html'))).toBe(true)
  })

  it.skipIf(!built)('never loads a resource over the network', () => {
    // Only *fetchable* references matter. A licence comment mentioning a URL
    // (e.g. GSAP's "https://gsap.com" in its banner) is inert text, not a load,
    // so we look for URLs inside src/href/url()/import() positions specifically.
    const loaders = [
      /(?:src|href|poster|data)\s*=\s*["']\s*(https?:\/\/[^"']+)/gi,
      /url\(\s*["']?\s*(https?:\/\/[^)"']+)/gi,
      /\bimport\s*\(\s*["'](https?:\/\/[^"']+)/gi,
      /\bfrom\s*["'](https?:\/\/[^"']+)/gi,
      /@import\s+(?:url\()?["'](https?:\/\/[^"')]+)/gi,
      /fetch\(\s*["'`](https?:\/\/[^"'`]+)/gi,
      /new\s+XMLHttpRequest[\s\S]{0,200}?open\(\s*["'][^"']*["']\s*,\s*["'`](https?:\/\/[^"'`]+)/gi,
    ]
    const offenders: string[] = []
    for (const f of scannable(distFiles())) {
      const text = readFileSync(f, 'utf8')
      for (const re of loaders) {
        for (const m of text.matchAll(re)) {
          offenders.push(`${path.relative(ROOT, f)} -> ${m[1]}`)
        }
      }
    }
    expect(offenders, 'the build must not load anything over the network').toEqual([])
  })

  it.skipIf(!built)('the only absolute URLs anywhere are inert licence text', () => {
    // Belt and braces: list everything so an unexpected remote reference is
    // visible in the failure output even if it slips past the loaders above.
    const found = new Set<string>()
    for (const f of scannable(distFiles())) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) found.add(m[0]!)
    }
    // XML namespace URIs are identifiers, never fetched.
    const inert = (u: string) => /^https?:\/\/www\.w3\.org\//.test(u)
    const suspicious = [...found].filter((u) => !inert(u))
    for (const u of suspicious) {
      // Every remaining URL must be a bare domain with no path — i.e. a
      // licence/attribution string, not a fetchable resource.
      expect(u, `unexpected remote resource: ${u}`).toMatch(/^https:\/\/[a-z0-9.-]+\/?$/)
    }
  })

  it.skipIf(!built)('uses no protocol-relative URLs', () => {
    for (const f of scannable(distFiles())) {
      const text = readFileSync(f, 'utf8')
      expect(text, path.relative(ROOT, f)).not.toMatch(/(?:src|href)\s*=\s*["']\/\//)
    }
  })

  it.skipIf(!built)('bundles every texture the config references', () => {
    for (const t of Object.values(textures)) {
      if (typeof t !== 'string' || !t.startsWith('assets/')) continue
      const p = path.join(DIST, t)
      expect(existsSync(p), `missing texture: ${t}`).toBe(true)
      expect(statSync(p).size).toBeGreaterThan(2000)
    }
  })

  it.skipIf(!built)('bundles every sound the config references', () => {
    for (const s of Object.values(sfxPaths)) {
      const p = path.join(DIST, s)
      expect(existsSync(p), `missing sound: ${s}`).toBe(true)
      expect(statSync(p).size).toBeGreaterThan(1000)
    }
  })

  it.skipIf(!built)('self-hosts the webfonts rather than calling Google Fonts', () => {
    for (const f of ['bungee-400.woff2', 'anton-400.woff2', 'barlow-condensed-700.woff2']) {
      expect(existsSync(path.join(DIST, 'assets/fonts', f)), f).toBe(true)
    }
    const css = distFiles().filter((f) => f.endsWith('.css'))
    for (const c of css) {
      expect(readFileSync(c, 'utf8')).not.toContain('fonts.googleapis.com')
      expect(readFileSync(c, 'utf8')).not.toContain('fonts.gstatic.com')
    }
  })

  it.skipIf(!built)('ships its JavaScript and CSS as local files', () => {
    const files = distFiles()
    expect(files.some((f) => f.endsWith('.js'))).toBe(true)
    expect(files.some((f) => f.endsWith('.css'))).toBe(true)
  })

  it.skipIf(!built)('uses relative asset URLs so the folder can be moved anywhere', () => {
    const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!)
    const local = refs.filter((r) => !r.startsWith('#') && !r.startsWith('data:'))
    expect(local.length).toBeGreaterThan(0)
    for (const r of local) {
      expect(r, `asset "${r}" must be relative`).toMatch(/^\.\//)
    }
  })

  it.skipIf(!built)('is a self-contained folder that can be copied to a USB stick', () => {
    // Nothing in dist should point outside itself.
    const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
    expect(html).not.toContain('/src/')
    expect(html).not.toContain('node_modules')
  })
})

describe('source-level offline guarantees', () => {
  it('no source file imports anything over the network', () => {
    const files = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|css|html)$/.test(f))
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](https?:\/\/[^'"]+)['"]/g)) {
        offenders.push(`${path.relative(ROOT, f)} -> ${m[1]}`)
      }
      // CSS url() must also be local.
      for (const m of text.matchAll(/url\(\s*['"]?(https?:\/\/[^)'"]+)/g)) {
        offenders.push(`${path.relative(ROOT, f)} -> ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every asset path in the config is relative to public/', () => {
    const paths: string[] = [
      ...Object.values(sfxPaths),
      ...Object.entries(textures)
        .filter(([, v]) => typeof v === 'string')
        .map(([, v]) => String(v)),
    ]
    for (const p of paths) {
      expect(p.startsWith('assets/'), p).toBe(true)
      expect(existsSync(path.join(ROOT, 'public', p)), `missing on disk: ${p}`).toBe(true)
    }
  })

  it('every declared sound has a non-empty file', () => {
    for (const [name, p] of Object.entries(sfxPaths)) {
      const full = path.join(ROOT, 'public', p)
      expect(existsSync(full), name).toBe(true)
      expect(statSync(full).size, name).toBeGreaterThan(1000)
    }
  })
})
