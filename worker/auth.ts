import { HttpError } from './db'

const COOKIE = 'org_session'
const SESSION_DAYS = 180
const MAX_FAILS = 10
const FAIL_WINDOW_MS = 15 * 60_000

const enc = new TextEncoder()

async function sha256(data: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', enc.encode(data))
}

export async function sha256Hex(data: string): Promise<string> {
  return [...new Uint8Array(await sha256(data))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

function cookieHeader(value: string, maxAge: number, secure: boolean) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

const jsonHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

/** Prüft die Sitzung; wirft 401, wenn keine gültige da ist */
export async function requireSession(req: Request, sql: SqlStorage): Promise<void> {
  const token = readCookie(req, COOKIE)
  if (!token) throw new HttpError(401, 'Nicht angemeldet')
  const hash = await sha256Hex(token)
  const now = new Date()
  const rows = sql.exec<{ last_seen: string }>(`SELECT last_seen FROM sessions WHERE token_hash = ? AND expires_at > ?`, hash, now.toISOString()).toArray()
  if (!rows.length) throw new HttpError(401, 'Nicht angemeldet')
  // höchstens einmal am Tag verlängern
  if (now.getTime() - Date.parse(rows[0].last_seen) > 86_400_000) {
    const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString()
    sql.exec(`UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?`, now.toISOString(), expires, hash)
  }
}

export async function login(req: Request, sql: SqlStorage, appPassword: string | undefined): Promise<Response> {
  if (!appPassword) throw new HttpError(503, 'APP_PASSWORD ist im Cloudflare-Dashboard noch nicht gesetzt.')
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local'
  const now = Date.now()

  const fails = sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?`, ip, now - FAIL_WINDOW_MS).one().n
  if (fails >= MAX_FAILS) throw new HttpError(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.')

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null
  const given = typeof body?.password === 'string' ? body.password : ''
  const [a, b] = await Promise.all([sha256(given), sha256(appPassword)])
  const ok = given.length > 0 && crypto.subtle.timingSafeEqual(a, b)

  if (!ok) {
    sql.exec(`INSERT INTO login_attempts (ip, ts) VALUES (?, ?)`, ip, now)
    throw new HttpError(401, 'Passwort falsch.')
  }

  const token = randomToken()
  const hash = await sha256Hex(token)
  const nowIso = new Date(now).toISOString()
  const expires = new Date(now + SESSION_DAYS * 86_400_000).toISOString()
  sql.exec(
    `INSERT INTO sessions (token_hash, created_at, expires_at, last_seen, user_agent) VALUES (?, ?, ?, ?, ?)`,
    hash,
    nowIso,
    expires,
    nowIso,
    (req.headers.get('User-Agent') ?? '').slice(0, 200),
  )
  sql.exec(`DELETE FROM login_attempts WHERE ip = ?`, ip)
  const secure = new URL(req.url).protocol === 'https:'
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...jsonHeaders, 'Set-Cookie': cookieHeader(token, SESSION_DAYS * 86_400, secure) },
  })
}

export async function logout(req: Request, sql: SqlStorage): Promise<Response> {
  const token = readCookie(req, COOKIE)
  if (token) sql.exec(`DELETE FROM sessions WHERE token_hash = ?`, await sha256Hex(token))
  const secure = new URL(req.url).protocol === 'https:'
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...jsonHeaders, 'Set-Cookie': cookieHeader('', 0, secure) },
  })
}
