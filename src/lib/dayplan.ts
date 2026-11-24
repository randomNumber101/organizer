/**
 * „Heute“: welche Aufgaben sind an einem Tag dran, in welcher Reihenfolge, wie lange dauert das,
 * und wie viel Zeit ist neben den Terminen noch frei.
 */
import type { CalendarEvent, Task } from './types'
import { ancestors } from './tree'
import { isBlocked } from './blocking'
import { matchesSearch } from './compose'
import { busyTimes } from './autoplan'
import { localDayOf } from './dates'

export type Bucket = 'mini' | 'quick' | 'long' | 'none'

export const BUCKETS: { id: Bucket; label: string; hint: string }[] = [
  { id: 'mini', label: 'Mini', hint: 'bis 5 min' },
  { id: 'quick', label: 'Zwischendurch', hint: 'bis 15 min' },
  { id: 'long', label: 'Länger', hint: '30 min und mehr' },
  { id: 'none', label: 'Ohne Dauer', hint: 'noch nicht geschätzt' },
]

export const bucketOf = (t: Task): Bucket => (t.estimate === null || t.estimate === undefined ? 'none' : t.estimate <= 5 ? 'mini' : t.estimate <= 15 ? 'quick' : 'long')

export const DURATIONS: [number, string][] = [
  [5, '5 min'],
  [15, '15 min'],
  [30, '30 min'],
  [60, '1 h'],
  [120, '2 h'],
]

export function minutesText(m: number): string {
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/** Tagesreihenfolge: gesetzte Reihenfolge zuerst, Rest nach Uhrzeit, Priorität, Frist */
export function dayCompare(a: Task, b: Task): number {
  const ao = a.day_order ?? null
  const bo = b.day_order ?? null
  if (ao !== null && bo !== null && ao !== bo) return ao - bo
  if (ao !== null && bo === null) return -1
  if (ao === null && bo !== null) return 1
  if (a.start_at && b.start_at) return a.start_at.localeCompare(b.start_at)
  if (a.start_at) return -1
  if (b.start_at) return 1
  return a.priority - b.priority || (a.deadline ?? '9').localeCompare(b.deadline ?? '9') || a.created_at.localeCompare(b.created_at)
}

export interface DayPlan {
  /** offene, machbare Aufgaben des Tages in Reihenfolge (Unteraufgaben hängen an ihrer Aufgabe) */
  rows: Task[]
  /** warten noch auf andere Aufgaben */
  blocked: Task[]
  /** heute erledigt */
  done: Task[]
  /** geschätzte Minuten der offenen Aufgaben */
  minutes: number
  /** offene Aufgaben ohne Schätzung */
  unknown: number
}

export function planDay(tasks: Record<string, Task>, day: string, search = ''): DayPlan {
  const onDay = (t: Task) => t.due_date === day
  const nestedUnder = (t: Task) => ancestors(tasks, t).some((a) => onDay(a) && a.status === t.status)
  const open = Object.values(tasks).filter((t) => t.status === 'open' && onDay(t) && !nestedUnder(t) && matchesSearch(t, search))
  const rows = open.filter((t) => !isBlocked(tasks, t)).sort(dayCompare)
  const blocked = open.filter((t) => isBlocked(tasks, t)).sort(dayCompare)
  const done = Object.values(tasks)
    .filter((t) => t.status === 'done' && (onDay(t) || (!!t.completed_at && localDayOf(t.completed_at) === day)) && !ancestors(tasks, t).some((a) => a.status === 'done' && (onDay(a) || (!!a.completed_at && localDayOf(a.completed_at) === day))))
    .filter((t) => matchesSearch(t, search))
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  let minutes = 0
  let unknown = 0
  for (const t of rows) {
    if (t.start_at && t.end_at) minutes += Math.round((Date.parse(t.end_at) - Date.parse(t.start_at)) / 60_000)
    else if (t.estimate) minutes += t.estimate
    else unknown++
  }
  return { rows, blocked, done, minutes, unknown }
}

/** Was als Nächstes dran ist: erste Aufgabe der Reihenfolge (Termine erst kurz vor ihrer Zeit) */
export function nextUp(rows: Task[], now = Date.now()): Task | undefined {
  return rows.find((t) => !t.start_at || Date.parse(t.start_at) <= now + 30 * 60_000)
}

const minutesNow = (d = new Date()) => d.getHours() * 60 + d.getMinutes()
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** freie Minuten von jetzt (bzw. 8 Uhr an anderen Tagen) bis zum Tagesende, ohne Termine */
export function freeMinutes(day: string, today: string, end: string, events: CalendarEvent[]): number {
  const from = day === today ? minutesNow() : 8 * 60
  const until = toMin(end)
  if (until <= from) return 0
  // Aufgaben mit Uhrzeit zählen als Arbeit (sind schon in der Summe), deshalb nur Termine abziehen
  const busy = busyTimes(day, [], events)
  let free = 0
  let cur = from
  for (const b of busy.sort((x, y) => x.start - y.start)) {
    if (b.end <= cur) continue
    if (b.start >= until) break
    if (b.start > cur) free += Math.min(b.start, until) - cur
    cur = Math.max(cur, b.end)
  }
  if (cur < until) free += until - cur
  return Math.max(0, free)
}

/** nächster Termin heute (nicht ganztägig) */
export function nextEvent(events: CalendarEvent[], day: string, now = Date.now()): CalendarEvent | undefined {
  return events
    .filter((e) => !e.allDay && localDayOf(e.start) === day && Date.parse(e.start) > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0]
}
