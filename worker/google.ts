/**
 * Minimaler Google-Calendar- und Google-Tasks-Client für den Worker (fetch, keine Bibliothek).
 * OAuth 2.0 mit PKCE, Refresh-Token wird im Durable Object gespeichert.
 */

export interface GoogleEnv {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  // nur für lokale Tests überschreibbar
  GOOGLE_AUTH_URL?: string
  GOOGLE_TOKEN_URL?: string
  GOOGLE_API_URL?: string
  GOOGLE_TASKS_URL?: string
  GOOGLE_REVOKE_URL?: string
}

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  authUrl: string
  tokenUrl: string
  apiUrl: string
  tasksUrl: string
  revokeUrl: string
}

export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'

/** Alle Kalender lesen, einen eigenen Kalender „Organizer“ anlegen und darin schreiben, Google Aufgaben. */
/** Termine in allen Kalendern anlegen/ändern (Kalender-App-Ersatz) */
export const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
export const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.app.created', TASKS_SCOPE, EVENTS_SCOPE]

export const ORGANIZER_CALENDAR_NAME = 'Organizer'
export const ORGANIZER_CALENDAR_MARK = 'organizer-app'

export function googleConfig(env: GoogleEnv): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
  return {
    clientId: env.GOOGLE_CLIENT_ID.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
    authUrl: env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token',
    apiUrl: env.GOOGLE_API_URL ?? 'https://www.googleapis.com/calendar/v3',
    tasksUrl: env.GOOGLE_TASKS_URL ?? 'https://tasks.googleapis.com/tasks/v1',
    revokeUrl: env.GOOGLE_REVOKE_URL ?? 'https://oauth2.googleapis.com/revoke',
  }
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public reason?: string,
  ) {
    super(message)
  }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(new Uint8Array(digest)) }
}

export const randomState = () => b64url(crypto.getRandomValues(new Uint8Array(24)))

export function buildAuthUrl(cfg: GoogleConfig, opts: { state: string; challenge: string; redirectUri: string }): string {
  const u = new URL(cfg.authUrl)
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', opts.redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPES.join(' '))
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('include_granted_scopes', 'true')
  u.searchParams.set('state', opts.state)
  u.searchParams.set('code_challenge', opts.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type: string
}

async function tokenRequest(cfg: GoogleConfig, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
  })
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  if (!res.ok) throw new GoogleApiError(res.status, data.error_description ?? data.error ?? `Token-Fehler ${res.status}`, data.error)
  return data
}

export const exchangeCode = (cfg: GoogleConfig, code: string, verifier: string, redirectUri: string) =>
  tokenRequest(cfg, { code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' })

export const refreshAccessToken = (cfg: GoogleConfig, refreshToken: string) => tokenRequest(cfg, { refresh_token: refreshToken, grant_type: 'refresh_token' })

export async function revokeToken(cfg: GoogleConfig, token: string) {
  await fetch(cfg.revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined)
}

export interface ApiOpts {
  query?: Record<string, string | undefined>
  body?: unknown
  /** 'tasks' = Google Tasks API, sonst Calendar API */
  api?: 'calendar' | 'tasks'
}

/** Aufruf der Calendar- bzw. Tasks-API */
export async function gapi<T>(cfg: GoogleConfig, token: string, method: string, path: string, opts: ApiOpts = {}): Promise<T> {
  const u = new URL((opts.api === 'tasks' ? cfg.tasksUrl : cfg.apiUrl) + path)
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) u.searchParams.set(k, v)
  const res = await fetch(u.toString(), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } }
  if (!res.ok) throw new GoogleApiError(res.status, data.error?.message ?? `Google-Fehler ${res.status}`, data.error?.errors?.[0]?.reason)
  return data as T
}

// ---------------------------------------------------------------------------
// Typen (nur die Felder, die wir brauchen)
// ---------------------------------------------------------------------------
export interface GCalendarListEntry {
  id: string
  summary: string
  summaryOverride?: string
  description?: string
  backgroundColor?: string
  foregroundColor?: string
  primary?: boolean
  selected?: boolean
  accessRole: string
}

export interface GEventTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

export interface GEvent {
  id: string
  etag: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  colorId?: string
  start?: GEventTime
  end?: GEventTime
  extendedProperties?: { private?: Record<string, string> }
  recurringEventId?: string
  recurrence?: string[]
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  attendees?: { email?: string; displayName?: string; self?: boolean; responseStatus?: string }[]
  transparency?: 'opaque' | 'transparent'
}

export interface GEventList {
  items: GEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

export interface GTask {
  id: string
  etag?: string
  title?: string
  notes?: string
  /** RFC 3339, nur das Datum zählt */
  due?: string
  status?: 'needsAction' | 'completed'
  completed?: string
  updated: string
  deleted?: boolean
  hidden?: boolean
  parent?: string
}

export interface GTaskList {
  id: string
  title: string
  updated?: string
}

/** Farben der Termin-Farb-IDs (Google-Standardpalette) */
export const EVENT_COLORS: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
}
