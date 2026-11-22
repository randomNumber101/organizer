export type Horizon = 'backlog' | 'short' | 'long'
export type Status = 'open' | 'done'
export type Priority = 1 | 2 | 3 | 4

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
}

export interface GoogleCalendarInfo {
  id: string
  name: string
  color: string
  primary: boolean
  selected: boolean
}

export interface GoogleStatus {
  configured: boolean
  connected: boolean
  status?: 'ok' | 'reauth'
  email?: string | null
  calendars?: GoogleCalendarInfo[]
  /** Google Aufgaben: Berechtigung erteilt, eingeschaltet, letzter Fehler */
  tasks?: { granted: boolean; enabled: boolean; problem: string | null }
}

export const HORIZON_LABEL: Record<Horizon, string> = {
  short: 'Kurzfristig',
  long: 'Langfristig',
  backlog: 'Backlog',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'Hoch',
  2: 'Mittel',
  3: 'Niedrig',
  4: 'Keine',
}

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
}

export interface Prefs {
  views?: SavedView[]
  push?: PushPrefs
  ritual?: { planned?: string; reviewed?: string }
  board?: Record<string, unknown>
}
