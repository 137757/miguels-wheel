/**
 * Tiny static file server for the built app.
 *
 * The inspection and screenshot tools need a real HTTP origin (module scripts,
 * fetch, AudioContext), and they need to be able to start and stop the server
 * themselves so a single command can run end to end.
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

export function serve(port = 5199) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = path.join(DIST, url)
    // Directory requests and unknown paths fall back to index.html.
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
    if (!existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      // Needed if we ever want SharedArrayBuffer; harmless otherwise.
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    createReadStream(file).pipe(res)
  })

  return new Promise((resolve) => {
    // Port 0 asks the OS for a free ephemeral port; read the real one back.
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      const actual = typeof addr === 'object' && addr ? addr.port : port
      resolve({
        url: `http://127.0.0.1:${actual}`,
        port: actual,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      })
    })
  })
}

// Allow running standalone: `node tools/serve.mjs`
if (process.argv[1] && process.argv[1].endsWith('serve.mjs')) {
  const port = Number(process.env.PORT ?? 5199)
  const s = await serve(port)
  console.log(`Serving ${DIST} at ${s.url}`)
}
