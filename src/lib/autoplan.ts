import type { CalendarEvent, Task } from './types'
import { minutesOfDay, localDayOf } from './dates'

export interface Busy {
  start: number
  end: number
}

/** Belegte Zeiten eines Tages (Minuten ab Mitternacht): Termine + schon eingeplante Aufgaben */
export function busyTimes(day: string, tasks: Task[], events: CalendarEvent[]): Busy[] {
  const out: Busy[] = []
  for (const t of tasks) {
    if (!t.start_at || !t.end_at || localDayOf(t.start_at) !== day) continue
    const s = minutesOfDay(t.start_at)
    const e = localDayOf(t.end_at) === day ? minutesOfDay(t.end_at) : 24 * 60
    out.push({ start: s, end: Math.max(e, s + 15) })
  }
  for (const ev of events) {
    if (ev.allDay) continue
    const sd = localDayOf(ev.start)
    const ed = localDayOf(ev.end)
    if (sd > day || ed < day) continue
    const s = sd < day ? 0 : minutesOfDay(ev.start)
    const e = ed > day ? 24 * 60 : minutesOfDay(ev.end)
    if (e > s) out.push({ start: s, end: e })
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Verteilt Aufgaben in freie Lücken zwischen from und until.
 * Zwischen zwei Blöcken bleiben `gap` Minuten Luft. Was nicht passt, bekommt keine Zeit.
 * `sequential`: strikt in der gegebenen Reihenfolge (jede Aufgabe nach der vorigen) – sonst füllt
 * eine spätere, kurze Aufgabe auch eine frühere Lücke.
 */
export function autoPlan(
  items: { id: string; minutes: number }[],
  busy: Busy[],
  from: number,
  until: number,
  opts: { gap?: number; step?: number; sequential?: boolean } = {},
): Record<string, number> {
  const gap = opts.gap ?? 5
  const step = opts.step ?? 15
  const taken = [...busy]
  const out: Record<string, number> = {}
  const snap = (m: number) => Math.ceil(m / step) * step
  let cursor = from
  for (const it of items) {
    let start = snap(opts.sequential ? cursor : from)
    for (;;) {
      if (start + it.minutes > until) break
      const end = start + it.minutes
      const clash = taken.find((b) => start < b.end + gap && end + gap > b.start)
      if (!clash) {
        out[it.id] = start
        taken.push({ start, end })
        cursor = end + gap
        break
      }
      start = snap(clash.end + gap)
    }
  }
  return out
}
