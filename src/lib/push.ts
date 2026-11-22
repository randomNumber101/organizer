import { api } from './api'
import { deviceTimeZone } from './dates'

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** Läuft die App als installierte App? (iOS erlaubt Push nur dann) */
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))])
  return reg
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** Erlaubnis holen, beim Push-Dienst anmelden und dem Server Bescheid geben */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Dieser Browser kann keine Benachrichtigungen empfangen.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Benachrichtigungen sind für diese Seite blockiert – in den Browser-Einstellungen erlauben.')
  const reg = await registration()
  if (!reg) throw new Error('Die App ist noch nicht vollständig geladen – bitte neu laden und nochmal versuchen.')
  const { publicKey } = await api.pushKey()
  let sub = await reg.pushManager.getSubscription()
  // alter Schlüssel? Dann neu anmelden
  if (sub) {
    const cur = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
    const want = keyBytes(publicKey)
    if (!cur || cur.length !== want.length || cur.some((b, i) => b !== want[i])) {
      await sub.unsubscribe().catch(() => undefined)
      sub = null
    }
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    throw new Error(`Der Push-Dienst des Browsers hat die Anmeldung abgelehnt (${why}). In Brave/Vivaldi muss „Google-Dienste für Push“ erlaubt sein.`)
  }
  await api.pushSubscribe(sub.endpoint, deviceTimeZone())
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** Beim App-Start: Anmeldung auffrischen (Zeitzone, abgelaufene Endpunkte) */
export async function refreshPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (sub) await api.pushSubscribe(sub.endpoint, deviceTimeZone()).catch(() => undefined)
}
