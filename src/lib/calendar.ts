/**
 * Kalender: Raster für Monat/Jahr, Kalenderwochen, Farben, Termine eines Tages.
 */
import { addDays, format, getISOWeek, parseISO, startOfMonth } from 'date-fns'
import { de } from 'date-fns/locale'
import type { CalendarEvent, CalView, Prefs, Task } from './types'
import { addDaysStr, localDayOf, toDateStr, weekStart } from './dates'

export const CAL_VIEWS: { value: CalView; label: string; short: string; key: string }[] = [
  { value: 'day', label: 'Tag', short: 'Tag', key: 'd' },
  { value: '3day', label: '3 Tage', short: '3 T.', key: 'x' },
  { value: 'week', label: 'Woche', short: 'Woche', key: 'w' },
  { value: 'month', label: 'Monat', short: 'Monat', key: 'm' },
  { value: 'year', label: 'Jahr', short: 'Jahr', key: 'j' },
  { value: 'list', label: 'Liste', short: 'Liste', key: 'l' },
]

export const weekNumber = (day: string) => getISOWeek(parseISO(day))

/** 6 Wochen (42 Tage) ab dem Montag vor dem Monatsersten */
export function monthGrid(day: string): string[] {
  const first = toDateStr(startOfMonth(parseISO(day)))
  const start = weekStart(first)
  return Array.from({ length: 42 }, (_, i) => addDaysStr(start, i))
}

export const monthOf = (day: string) => day.slice(0, 7)
export const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`
export const addMonths = (day: string, n: number) => {
  const d = parseISO(firstOfMonth(day))
  d.setMonth(d.getMonth() + n)
  return toDateStr(d)
}
export const monthName = (day: string) => format(parseISO(day), 'MMMM', { locale: de })
export const yearOf = (day: string) => day.slice(0, 4)

/** sichtbarer Zeitraum je Ansicht */
export function viewRange(view: CalView, focus: string, mobile: boolean): { from: string; to: string; days: string[] } {
  if (view === 'day') return { from: focus, to: focus, days: [focus] }
  if (view === '3day') {
    const days = [0, 1, 2].map((i) => addDaysStr(focus, i))
    return { from: days[0], to: days[2], days }
  }
  if (view === 'week') {
    const start = mobile ? focus : weekStart(focus)
    const days = Array.from({ length: 7 }, (_, i) => addDaysStr(start, i))
    return { from: days[0], to: days[6], days }
  }
  if (view === 'month') {
    const days = monthGrid(focus)
    return { from: days[0], to: days[41], days }
  }
  if (view === 'year') {
    const y = yearOf(focus)
    return { from: `${y}-01-01`, to: `${y}-12-31`, days: [] }
  }
  const days = Array.from({ length: 30 }, (_, i) => addDaysStr(focus, i))
  return { from: days[0], to: days[29], days }
}

/** Schritt für „zurück/weiter“ */
export function stepFocus(view: CalView, focus: string, dir: 1 | -1, mobile: boolean): string {
  if (view === 'day') return addDaysStr(focus, dir)
  if (view === '3day') return addDaysStr(focus, 3 * dir)
  if (view === 'week') return addDaysStr(focus, (mobile ? 7 : 7) * dir)
  if (view === 'month') return addMonths(focus, dir)
  if (view === 'year') return `${Number(yearOf(focus)) + dir}-${focus.slice(5)}`
  return addDaysStr(focus, 30 * dir)
}

/** Farbe eines Termins: eigene Terminfarbe, sonst die (ggf. eigene) Kalenderfarbe */
export function evColor(e: CalendarEvent, prefs: Prefs): string {
  if (e.colorId) return e.color
  return prefs.calendar?.colors?.[e.calendarId] ?? e.color
}

/** Tage, an denen ein Termin stattfindet (ganztägig: Ende exklusiv) */
export function eventDays(e: CalendarEvent): string[] {
  if (e.allDay) {
    const out: string[] = []
    for (let d = e.start; d < e.end && out.length < 62; d = addDaysStr(d, 1)) out.push(d)
    return out.length ? out : [e.start]
  }
  const s = localDayOf(e.start)
  // Ende genau um Mitternacht zählt nicht als weiterer Tag
  const endMs = Date.parse(e.end) - 1
  const last = toDateStr(new Date(endMs))
  const out: string[] = []
  for (let d = s; d <= last && out.length < 31; d = addDaysStr(d, 1)) out.push(d)
  return out.length ? out : [s]
}

/** Termine je Tag (für Monat/Jahr/Liste) */
export function eventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) for (const d of eventDays(e)) {
    const arr = map.get(d) ?? []
    arr.push(e)
    map.set(d, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
  return map
}

/** Aufgaben je Tag (offen mit Tag; mit Uhrzeit am Tag ihres Beginns) */
export function tasksByDay(tasks: Record<string, Task>): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of Object.values(tasks)) {
    if (t.status !== 'open') continue
    const d = t.start_at ? localDayOf(t.start_at) : t.due_date
    if (!d) continue
    const arr = map.get(d) ?? []
    arr.push(t)
    map.set(d, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.start_at ?? '~').localeCompare(b.start_at ?? '~') || b.priority - a.priority)
  return map
}

export const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7)

/** Google-Terminfarben (colorId → Name) */
export const EVENT_COLOR_NAMES: [string, string, string][] = [
  ['1', '#7986cb', 'Lavendel'],
  ['2', '#33b679', 'Salbei'],
  ['3', '#8e24aa', 'Traube'],
  ['4', '#e67c73', 'Flamingo'],
  ['5', '#f6bf26', 'Banane'],
  ['6', '#f4511e', 'Mandarine'],
  ['7', '#039be5', 'Pfau'],
  ['8', '#616161', 'Graphit'],
  ['9', '#3f51b5', 'Heidelbeere'],
  ['10', '#0b8043', 'Basilikum'],
  ['11', '#d50000', 'Tomate'],
]

export const REPEAT_OPTIONS: [string, string][] = [
  ['', 'Nicht wiederholen'],
  ['RRULE:FREQ=DAILY', 'Täglich'],
  ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Werktags'],
  ['RRULE:FREQ=WEEKLY', 'Wöchentlich'],
  ['RRULE:FREQ=WEEKLY;INTERVAL=2', 'Alle 2 Wochen'],
  ['RRULE:FREQ=MONTHLY', 'Monatlich'],
  ['RRULE:FREQ=YEARLY', 'Jährlich'],
]

export const REMINDER_OPTIONS: [string, string][] = [
  ['default', 'Standard des Kalenders'],
  ['none', 'Keine Erinnerung'],
  ['0', 'Zum Beginn'],
  ['10', '10 Minuten vorher'],
  ['30', '30 Minuten vorher'],
  ['60', '1 Stunde vorher'],
  ['1440', '1 Tag vorher'],
]

export const fmtDayLong = (day: string) => format(parseISO(day), 'EEEE, d. MMMM yyyy', { locale: de })
export const nextDay = (day: string) => toDateStr(addDays(parseISO(day), 1))
