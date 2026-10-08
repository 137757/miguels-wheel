import { defineConfig } from 'vite'

// Relative base so the built app can be opened from any folder, a USB stick, or a
// plain `file://`-adjacent static host without rewriting asset URLs.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/gsap')) return 'gsap'
          if (id.includes('node_modules/canvas-confetti')) return 'confetti'
          return undefined
        },
      },
    },
  },
  server: {
    port: 5183,
    host: true,
  },
  preview: {
    port: 5199,
    host: true,
  },
})
