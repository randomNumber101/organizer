import type { CalendarEvent, EventInput, GoogleStatus, List, Prefs, Task, TaskPatch, Template, TemplateNode } from './types'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn
}

let currentOpId: string | null = null
/** Schickt die Anfragen in fn mit einer Änderungs-id, damit der Server Wiederholungen erkennt */
export function withOpId<T>(opId: string, fn: () => Promise<T>): Promise<T> {
  currentOpId = opId
  try {
    return fn()
  } finally {
    currentOpId = null
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (currentOpId) headers['X-Op-Id'] = currentOpId
  // Wichtigkeit 0–5 (ältere Versionen schickten 1–4, der Server rechnet die um)
  headers['X-Scale'] = '2'
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Keine Verbindung – bist du offline?')
  }
  const data = (res.headers.get('Content-Type') ?? '').includes('application/json') ? await res.json().catch(() => null) : null
  if (res.status === 401 && path !== '/api/login') onUnauthorized?.()
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Fehler ${res.status}`)
  return data as T
}

export interface SyncResult {
  cursor: number
  full: boolean
  lists: List[]
  tasks: Task[]
  deletedListIds: string[]
  deletedTaskIds: string[]
  templates: Template[]
  deletedTemplateIds: string[]
  prefs: Prefs
}

export type NewTaskBody = TaskPatch & { id: string; title: string }

export const api = {
  me: () => request<{ ok: true }>('GET', '/api/me'),
  login: (password: string) => request<{ ok: true }>('POST', '/api/login', { password }),
  logout: () => request<{ ok: true }>('POST', '/api/logout'),
  sync: (since: number) => request<SyncResult>('GET', `/api/sync?since=${since}`),
  rollover: (today: string) => request<{ moved: number }>('POST', '/api/rollover', { today }),

  createTask: (t: NewTaskBody) => request<Task>('POST', '/api/tasks', t),
  updateTask: (id: string, patch: TaskPatch) => request<Task>('PATCH', `/api/tasks/${id}`, patch),
  setStatus: (ids: string[], status: 'open' | 'done', today: string) =>
    request<{ tasks: Task[]; advanced: { id: string; next: string }[] }>('POST', '/api/tasks/bulk', { ids, status, today }),
  deleteTask: (id: string) => request<{ ids: string[] }>('DELETE', `/api/tasks/${id}`),
  restoreTasks: (ids: string[]) => request<{ tasks: Task[] }>('POST', '/api/tasks/restore', { ids }),

  createList: (l: Pick<List, 'id' | 'name' | 'color' | 'sort'>) => request<List>('POST', '/api/lists', l),
  updateList: (id: string, patch: Partial<Pick<List, 'name' | 'color' | 'sort' | 'archived'>>) => request<List>('PATCH', `/api/lists/${id}`, patch),
  deleteList: (id: string) => request<{ ok: true }>('DELETE', `/api/lists/${id}`),

  saveTemplate: (id: string, create: boolean, data: { name?: string; payload?: TemplateNode }) =>
    create ? request<Template>('POST', '/api/templates', { id, ...data }) : request<Template>('PATCH', `/api/templates/${id}`, data),
  deleteTemplate: (id: string) => request<{ ok: true }>('DELETE', `/api/templates/${id}`),
  setPref: (key: string, value: unknown) => request<{ ok: true }>('PUT', `/api/prefs/${key}`, { value }),

  pushKey: () => request<{ publicKey: string }>('GET', '/api/push/key'),
  pushSubscribe: (endpoint: string, timezone: string) => request<{ ok: true }>('POST', '/api/push/subscribe', { endpoint, timezone }),
  pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/api/push/unsubscribe', { endpoint }),
  pushTest: () => request<{ sent: number }>('POST', '/api/push/test'),

  googleStatus: () => request<GoogleStatus>('GET', '/api/google/status'),
  googleEvents: (from: string, to: string) => request<{ events: CalendarEvent[] }>('GET', `/api/google/events?from=${from}&to=${to}`),
  googleDisconnect: () => request<{ ok: true }>('POST', '/api/google/disconnect'),
  googleCalendars: (selected: string[]) => request<{ ok: true }>('POST', '/api/google/calendars', { selected }),
  googleTasks: (enabled: boolean) => request<GoogleStatus>('POST', '/api/google/tasks', { enabled }),
  googleRefresh: () => request<{ ok: true }>('POST', '/api/google/refresh'),
  createEvent: (input: EventInput) => request<CalendarEvent>('POST', '/api/google/events', input),
  updateEvent: (body: { calendarId: string; id: string; recurringId?: string | null; all?: boolean; toCalendar?: string; patch: Partial<EventInput> }) => request<CalendarEvent | { ok: true }>('PATCH', '/api/google/events', body),
  deleteEvent: (body: { calendarId: string; id: string; recurringId?: string | null; all?: boolean }) => request<{ ok: true }>('POST', '/api/google/events/delete', body),
  searchEvents: (q: string) => request<{ events: CalendarEvent[] }>('GET', `/api/google/search?q=${encodeURIComponent(q)}`),
}

/**
 * Live-Verbindung: der Server meldet „changed“, sobald irgendein Gerät etwas geändert hat.
 * Verbindet sich bei Abbruch selbst neu.
 */
export function connectLive(onChanged: () => void, onStatus: (connected: boolean) => void): () => void {
  let ws: WebSocket | null = null
  let stopped = false
  let retry = 0
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    if (stopped) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/api/live`)
    ws.onopen = () => {
      retry = 0
      onStatus(true)
      onChanged() // was in der Zwischenzeit passiert ist, nachholen
      heartbeat = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
    }
    ws.onmessage = (e) => {
      if (e.data === 'pong') return
      onChanged()
    }
    ws.onclose = () => {
      clearInterval(heartbeat)
      onStatus(false)
      if (stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** retry++)
      reconnectTimer = setTimeout(open, delay)
    }
    ws.onerror = () => ws?.close()
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState === WebSocket.CLOSED)) {
      clearTimeout(reconnectTimer)
      retry = 0
      open()
    }
  }
  document.addEventListener('visibilitychange', onVisible)
  open()

  return () => {
    stopped = true
    clearInterval(heartbeat)
    clearTimeout(reconnectTimer)
    document.removeEventListener('visibilitychange', onVisible)
    ws?.close()
  }
}
