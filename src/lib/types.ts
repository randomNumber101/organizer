export type Horizon = 'backlog' | 'short' | 'long'
export type Status = 'open' | 'done'
/** Wichtigkeit: 0 = keine … 5 = dringend */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5

export interface List {
  id: string
  name: string
  color: string
  sort: number
  archived: boolean
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  list_id: string | null
  parent_id: string | null
  title: string
  notes: string | null
  status: Status
  priority: Priority
  horizon: Horizon
  tags: string[]
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
  /** Frist – getrennt vom Tag, an dem man die Aufgabe erledigen will (due_date) */
  deadline: string | null
  /** wartet auf diese Aufgaben */
  blocked_by: string[]
  /** kurze laufende Nummer (vom Server vergeben, offline angelegte erst nach dem Abgleich) */
  num: number | null
  /** geschätzte Dauer in Minuten */
  estimate: number | null
  /** verknüpfte Google Aufgabe (Aufgaben mit Tag, ohne Uhrzeit) */
  gtask_id?: string | null
  /** Reihenfolge innerhalb des Tages (null = noch nicht einsortiert) */
  day_order: number | null
  /** Teil einer aufgeteilten Aufgabe (1, 2, 3 … unter der Hauptaufgabe); null = normale Aufgabe */
  part_index: number | null
  created_at: string
  updated_at: string
}

export type TaskPatch = Partial<Omit<Task, 'id' | 'num' | 'gtask_id' | 'created_at' | 'updated_at' | 'rollover_count' | 'completed_at' | 'gcal_event_id' | 'gcal_etag'>>

export type ViewName = 'board' | 'today' | 'calendar'
export type BoardMode = 'lists' | 'week'

export interface CalendarEvent {
  id: string
  calendarId: string
  calendarName: string
  title: string
  /** ISO-Zeitpunkt oder bei ganztägigen Terminen YYYY-MM-DD */
  start: string
  end: string
  allDay: boolean
  color: string
  location: string | null
  link: string | null
  description?: string | null
  /** darf geändert werden */
  writable?: boolean
  colorId?: string | null
  /** gehört zu einer Serie (id des Ursprungstermins) */
  recurringId?: string | null
  meet?: string | null
  guests?: number
  /** lokal angelegt, wartet noch auf Google */
  pending?: boolean
}

export type CalView = 'day' | '3day' | 'week' | 'month' | 'year' | 'list'

/** Termin anlegen/ändern */
export interface EventInput {
  calendarId: string
  title: string
  allDay: boolean
  /** ISO bzw. YYYY-MM-DD */
  start: string
  /** ISO bzw. YYYY-MM-DD (exklusiv) */
  end: string
  timeZone?: string
  location?: string | null
  description?: string | null
  colorId?: string | null
  recurrence?: string | null
  /** Minuten vorher (null = Standard des Kalenders) */
  reminders?: number[] | null
}

export interface GoogleCalendarInfo {
  id: string
  name: string
  color: string
  primary: boolean
  selected: boolean
  writable?: boolean
}

export interface GoogleStatus {
  configured: boolean
  connected: boolean
  status?: 'ok' | 'reauth'
  email?: string | null
  calendars?: GoogleCalendarInfo[]
  /** Google Aufgaben: Berechtigung erteilt, eingeschaltet, letzter Fehler */
  tasks?: { granted: boolean; enabled: boolean; problem: string | null }
  /** Termine bearbeiten erlaubt (Berechtigung calendar.events) */
  events?: { granted: boolean }
}

export const HORIZON_LABEL: Record<Horizon, string> = {
  short: 'Kurzfristig',
  long: 'Langfristig',
  backlog: 'Backlog',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  5: 'Dringend',
  4: 'Hoch',
  3: 'Mittel',
  2: 'Niedrig',
  1: 'Sehr niedrig',
  0: 'Keine',
}

/** von wichtig nach unwichtig */
export const PRIORITIES: Priority[] = [5, 4, 3, 2, 1, 0]

/** ab dieser Stufe gilt eine Aufgabe als „wichtig“ (Vorschläge, Sortierung) */
export const IMPORTANT = 3

export const LIST_COLORS = ['#3f6f5f', '#4a6fa5', '#b6583e', '#b88a2a', '#7b5ea7', '#3b8a8c', '#a24d6f', '#6b7280']

export interface TemplateNode {
  title: string
  notes?: string | null
  priority?: number
  tags?: string[]
  rrule?: string | null
  subtasks?: TemplateNode[]
}

export interface Template {
  id: string
  name: string
  payload: TemplateNode
  created_at: string
  updated_at: string
}

export type WhenFilter = 'overdue' | 'today' | 'week' | 'nodate'
export interface TaskFilter {
  lists?: string[] // 'inbox' = ohne Liste
  tags?: string[]
  priorities?: number[]
  when?: WhenFilter | null
  deadline?: 'soon' | 'any' | null
  state?: 'blocked' | 'free' | null
}

export interface SavedView {
  id: string
  name: string
  filter: TaskFilter
  search?: string
}

export interface PushPrefs {
  morning: string | null
  evening: string | null
  lead: number
  /** auch vor Google-Terminen erinnern (Standard: an) */
  events?: boolean
}

export type TodayMode = 'order' | 'duration' | 'prio'

export interface Prefs {
  views?: SavedView[]
  push?: PushPrefs
  ritual?: { planned?: string; reviewed?: string }
  /** Tagesende für „noch frei“ in Heute (HH:mm) */
  day?: { end?: string }
  board?: Record<string, unknown>
  /** Kalender: eigene Farben je Kalender, Wochennummern, Standard-Kalender für neue Termine */
  calendar?: { colors?: Record<string, string>; weekNumbers?: boolean; defaultCalendar?: string | null }
}
