/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import type { PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> }

self.addEventListener('install', () => {
  void self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
// Seitenaufrufe bekommen die App – außer Server-Adressen wie die Google-Anmeldung (/api/…)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/(datenschutz|nutzungsbedingungen)/] }))

// ---------------------------------------------------------------------------
// Push: Der Server schickt nur einen leeren „Stups“. Den Inhalt holen wir uns hier ab –
// so muss nichts verschlüsselt werden und es landet nichts bei Google/Mozilla/Apple.
// ---------------------------------------------------------------------------
interface Pending {
  id: string
  title: string
  body: string
  url: string | null
  tag: string | null
}

const SHOWN = '/__organizer-shown'

async function shownIds(): Promise<string[]> {
  const cache = await caches.open('organizer-meta')
  const res = await cache.match(SHOWN)
  return res ? ((await res.json()) as string[]) : []
}

async function rememberShown(ids: string[]) {
  const cache = await caches.open('organizer-meta')
  await cache.put(SHOWN, new Response(JSON.stringify(ids.slice(-100)), { headers: { 'Content-Type': 'application/json' } }))
}

async function showPending() {
  let items: Pending[] = []
  try {
    const res = await fetch('/api/push/pending', { credentials: 'same-origin', cache: 'no-store' })
    if (res.ok) items = ((await res.json()) as { notifications: Pending[] }).notifications
  } catch {
    /* offline – unten Ersatz zeigen */
  }
  const seen = await shownIds()
  const fresh = items.filter((n) => !seen.includes(n.id))
  if (!fresh.length) {
    // Browser verlangen bei jedem Push eine sichtbare Meldung
    if (!items.length) await self.registration.showNotification('Organizer', { body: 'Du hast eine neue Erinnerung.', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: 'fallback' })
    return
  }
  for (const n of fresh) {
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: n.tag ?? n.id,
      data: { url: n.url ?? '/' },
    })
  }
  await rememberShown([...seen, ...fresh.map((n) => n.id)])
}

self.addEventListener('push', (event) => {
  event.waitUntil(showPending())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin)
      if (win) {
        await win.focus()
        win.postMessage({ type: 'open', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
