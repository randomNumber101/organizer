import { isValidRRule } from '../shared/recurrence'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Datensätze
// ---------------------------------------------------------------------------
export type TaskRow = {
  id: string
  list_id: string | null
  parent_id: string | null
  title: string
  notes: string | null
  status: 'open' | 'done'
  priority: number
  horizon: 'backlog' | 'short' | 'long'
  tags: string
  due_date: string | null
  start_at: string | null
  end_at: string | null
  timezone: string | null
  rrule: string | null
  rollover_count: number
  completed_at: string | null
  sort: number
  gcal_event_id: string | null
  gcal_etag: string | null
  origin_event_id: string | null
  gcal_dirty: number
  deadline: string | null
  blocked_by: string
  num: number | null
  estimate: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

export type ListRow = {
  id: string
  name: string
  color: string
  sort: number
  archived: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  seq: number
}

const parseArr = (v: string | null | undefined): string[] => {
  try {
    const a = JSON.parse(v ?? '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function taskOut(r: TaskRow) {
  const { deleted_at: _d, seq: _s, gcal_dirty: _g, tags, blocked_by, ...rest } = r
  return { ...rest, tags: parseArr(tags), blocked_by: parseArr(blocked_by) }
}

export function listOut(r: ListRow) {
  const { deleted_at: _d, seq: _s, archived, ...rest } = r
  return { ...rest, archived: archived === 1 }
}

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const COLOR = /^#[0-9a-fA-F]{6}$/

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v))
/** Frist: Tag (YYYY-MM-DD) oder Tag mit Uhrzeit in Ortszeit (YYYY-MM-DDTHH:mm) */
export const isDeadline = (v: unknown): v is string =>
  isDate(v) || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(v) && isDate(v.slice(0, 10)))

function isIso(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))
}

function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return true
  } catch {
    return false
  }
}

/** Kalenderdatum eines Zeitpunkts in einer Zeitzone (YYYY-MM-DD) */
export function dateInZone(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export type TaskInput = Partial<{
  id: string
  list_id: string | null
  parent_id: string | null
  title: string
  notes: string | null
  status: 'open' | 'done'
  priority: number
  horizon: 'backlog' | 'short' | 'long'
  tags: string[]
  due_date: string | null
  start_at: string | null
  end_at: string | null
  timezone: string | null
  rrule: string | null
  sort: number
  origin_event_id: string | null
  deadline: string | null
  blocked_by: string[]
  estimate: number | null
}>

const bad = (msg: string): never => {
  throw new HttpError(400, msg)
}

/** Prüft erlaubte Felder und Typen. Unbekannte Felder werden ignoriert. */
export function cleanTaskInput(body: unknown): TaskInput {
  if (!body || typeof body !== 'object') bad('Ungültige Daten')
  const b = body as Record<string, unknown>
  const out: TaskInput = {}
  if ('id' in b) out.id = isUuid(b.id) ? b.id : bad('Ungültige id')
  if ('title' in b) {
    const t = typeof b.title === 'string' ? b.title.trim() : ''
    out.title = t.length >= 1 && t.length <= 500 ? t : bad('Titel fehlt oder ist zu lang')
  }
  if ('notes' in b) out.notes = b.notes === null || b.notes === '' ? null : typeof b.notes === 'string' && b.notes.length <= 20000 ? b.notes : bad('Notiz ungültig')
  if ('list_id' in b) out.list_id = b.list_id === null ? null : isUuid(b.list_id) ? b.list_id : bad('Ungültige Liste')
  if ('parent_id' in b) out.parent_id = b.parent_id === null ? null : isUuid(b.parent_id) ? b.parent_id : bad('Ungültige Elternaufgabe')
  if ('status' in b) out.status = b.status === 'open' || b.status === 'done' ? b.status : bad('Ungültiger Status')
  if ('priority' in b) out.priority = Number.isInteger(b.priority) && (b.priority as number) >= 1 && (b.priority as number) <= 4 ? (b.priority as number) : bad('Ungültige Priorität')
  if ('horizon' in b) out.horizon = b.horizon === 'backlog' || b.horizon === 'short' || b.horizon === 'long' ? b.horizon : bad('Ungültiger Zeithorizont')
  if ('tags' in b) {
    const tags = Array.isArray(b.tags) ? b.tags : bad('Tags ungültig')
    const clean = [...new Set(tags.map((t) => (typeof t === 'string' ? t.trim().toLowerCase().replace(/^#/, '') : '')).filter((t) => t.length > 0 && t.length <= 40))]
    out.tags = clean.length <= 30 ? clean : bad('Zu viele Tags')
  }
  if ('due_date' in b) out.due_date = b.due_date === null || b.due_date === '' ? null : isDate(b.due_date) ? b.due_date : bad('Ungültiges Datum')
  if ('start_at' in b) out.start_at = b.start_at === null ? null : isIso(b.start_at) ? new Date(b.start_at).toISOString() : bad('Ungültige Startzeit')
  if ('end_at' in b) out.end_at = b.end_at === null ? null : isIso(b.end_at) ? new Date(b.end_at).toISOString() : bad('Ungültige Endzeit')
  if ('timezone' in b) out.timezone = b.timezone === null ? null : isTimeZone(b.timezone) ? b.timezone : bad('Ungültige Zeitzone')
  if ('rrule' in b) out.rrule = b.rrule === null || b.rrule === '' ? null : typeof b.rrule === 'string' && b.rrule.length <= 200 && isValidRRule(b.rrule) ? b.rrule.toUpperCase() : bad('Ungültige Wiederholung')
  if ('deadline' in b) out.deadline = b.deadline === null || b.deadline === '' ? null : isDeadline(b.deadline) ? b.deadline : bad('Ungültige Frist')
  if ('estimate' in b) out.estimate = b.estimate === null ? null : Number.isInteger(b.estimate) && (b.estimate as number) >= 1 && (b.estimate as number) <= 1440 ? (b.estimate as number) : bad('Ungültige Dauer')
  if ('blocked_by' in b) {
    const v = Array.isArray(b.blocked_by) ? b.blocked_by : bad('Ungültige Abhängigkeiten')
    out.blocked_by = v.length <= 20 && v.every(isUuid) ? [...new Set(v as string[])] : bad('Ungültige Abhängigkeiten')
  }
  if ('origin_event_id' in b) out.origin_event_id = b.origin_event_id === null ? null : typeof b.origin_event_id === 'string' && b.origin_event_id.length <= 1100 ? b.origin_event_id : bad('Ungültiger Termin-Verweis')
  if ('sort' in b) out.sort = typeof b.sort === 'number' && Number.isFinite(b.sort) ? b.sort : bad('Ungültige Sortierung')
  return out
}

/** Endgültigen Zustand prüfen und abgeleitete Felder setzen (wie der frühere DB-Trigger) */
export function normalizeTask<T extends { start_at: string | null; end_at: string | null; timezone: string | null; due_date: string | null; status: string; completed_at: string | null }>(t: T, now: string): T {
  const out = { ...t }
  if ((out.start_at === null) !== (out.end_at === null)) bad('Zeitblock braucht Start und Ende')
  if (out.start_at && out.end_at) {
    if (Date.parse(out.end_at) <= Date.parse(out.start_at)) bad('Ende muss nach dem Start liegen')
    if (!out.timezone) bad('Zeitblock braucht eine Zeitzone')
    out.due_date = dateInZone(out.start_at, out.timezone!)
  }
  if (out.status === 'done' && !out.completed_at) out.completed_at = now
  if (out.status === 'open') out.completed_at = null
  return out
}

export function cleanListInput(body: unknown) {
  if (!body || typeof body !== 'object') bad('Ungültige Daten')
  const b = body as Record<string, unknown>
  const out: Partial<{ id: string; name: string; color: string; sort: number; archived: boolean }> = {}
  if ('id' in b) out.id = isUuid(b.id) ? b.id : bad('Ungültige id')
  if ('name' in b) {
    const n = typeof b.name === 'string' ? b.name.trim() : ''
    out.name = n.length >= 1 && n.length <= 100 ? n : bad('Name fehlt oder ist zu lang')
  }
  if ('color' in b) out.color = typeof b.color === 'string' && COLOR.test(b.color) ? b.color : bad('Ungültige Farbe')
  if ('sort' in b) out.sort = typeof b.sort === 'number' && Number.isFinite(b.sort) ? b.sort : bad('Ungültige Sortierung')
  if ('archived' in b) out.archived = typeof b.archived === 'boolean' ? b.archived : bad('Ungültiger Wert')
  return out
}
