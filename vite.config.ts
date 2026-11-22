import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // `npm run dev` + parallel `npm run dev:api`: API-Aufrufe an den lokalen Worker weiterreichen
  server: {
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
  plugins: [
    react(),
    VitePWA({
      // Eigener Service Worker, damit später Push-Benachrichtigungen dazukommen können
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Organizer',
        short_name: 'Organizer',
        description: 'Aufgaben, Listen und Tagesplanung',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f5f2',
        theme_color: '#2f5d50',
        // Android: „Teilen“ → Organizer legt eine Aufgabe an
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        // Langes Drücken aufs App-Symbol
        shortcuts: [
          { name: 'Neue Aufgabe', short_name: 'Neu', url: '/?action=new', icons: [{ src: '/icons/shortcut-new.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Tag planen', short_name: 'Planen', url: '/?action=plan', icons: [{ src: '/icons/shortcut-plan.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Heute', short_name: 'Heute', url: '/?view=today', icons: [{ src: '/icons/shortcut-today.png', sizes: '96x96', type: 'image/png' }] },
        ],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
})
