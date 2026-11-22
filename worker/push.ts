/**
 * Web Push ohne Nachrichteninhalt („tickle“): Der Server weckt nur den Service Worker auf,
 * der sich die eigentlichen Hinweise dann selbst per /api/push/pending holt.
 * Dadurch entfällt die Inhalts-Verschlüsselung – nötig ist nur die VAPID-Signatur (ES256 per WebCrypto).
 */

const enc = new TextEncoder()

export const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export interface VapidKeys {
  /** unkomprimierter öffentlicher Schlüssel (65 Byte), base64url – geht an den Browser */
  publicKey: string
  privateJwk: JsonWebKey
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return { publicKey: b64url(raw), privateJwk }
}

/** Authorization-Header nach RFC 8292 */
export async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`))
  return `vapid t=${header}.${payload}.${b64url(sig)}, k=${keys.publicKey}`
}

export type PushResult = 'ok' | 'gone' | 'error'

export async function sendTickle(endpoint: string, keys: VapidKeys, subject: string): Promise<PushResult> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidHeader(endpoint, keys, subject), TTL: '900', Urgency: 'high' },
      body: '',
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    if (!res.ok) {
      console.warn('push', res.status, (await res.text().catch(() => '')).slice(0, 200))
      return 'error'
    }
    return 'ok'
  } catch (e) {
    console.warn('push', e)
    return 'error'
  }
}

export function validEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 1000) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  } catch {
    return false
  }
}
