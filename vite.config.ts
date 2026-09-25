import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE_PATH ?? '/'

// Serve the dev server over HTTPS when a cert pair is provided, so phones on the
// LAN get a secure context (WebCrypto and the camera need one). See server/README.md
// for generating a self-signed pair shared with the sync server.
const certFile = process.env.DEV_TLS_CERT ?? 'certs/dev.crt'
const keyFile = process.env.DEV_TLS_KEY ?? 'certs/dev.key'
const https = fs.existsSync(certFile) && fs.existsSync(keyFile)
  ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
  : undefined

export default defineConfig({
  base,
  server: { host: true, ...(https ? { https } : {}) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '2Dai',
        short_name: '2Dai',
        description: 'A calm, local-first daily task manager.',
        theme_color: '#1e5784',
        background_color: '#f7f9fb',
        display: 'standalone',
        scope: base,
        start_url: base,
        icons: [
          { src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}maskable-icon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
})
