import { parseLang, type Parsed } from './lang'
import { deviceTimeZone, localDateTimeToIso, minutesBetween, plusMinutesIso, todayStr } from './dates'
import type { List, Task, TaskPatch } from './types'
import { descendantIds } from './tree'
import { wouldCycle } from './blocking'
import { moveBlockToDate } from '../../shared/tz'

export interface Composed {
  parsed: Parsed
  patch: TaskPatch & { title: string }
  /** Liste per @name angegeben, gibt es aber noch nicht */
  newListName?: string
  matchedList?: List
}

const EMPTY: Record<string, Task> = {}

/** Text aus einer Eingabe + Vorgaben der Stelle (Spalte, Tag …) → neue Aufgabe */
export function composeTask(text: string, defaults: TaskPatch, lists: Record<string, List>, tasks: Record<string, Task> = EMPTY): Composed {
  const today = todayStr()
  const parsed = parseLang(text, { today, lists, tasks })
  const parent = parsed.parent ? tasks[parsed.parent.id] : undefined
  const patch: TaskPatch & { title: string } = {
    ...defaults,
    title: parsed.title,
    priority: parsed.priority ?? defaults.priority ?? 0,
    tags: [...new Set([...(defaults.tags ?? []), ...parsed.tags])],
    list_id: parsed.list?.id ?? (parent ? parent.list_id : defaults.list_id) ?? null,
    due_date: parsed.dueDate ?? defaults.due_date ?? null,
  }
  if (parent) patch.parent_id = parent.id
  if (parsed.waitFor.length) patch.blocked_by = [...new Set([...(defaults.blocked_by ?? []), ...parsed.waitFor.map((w) => w.id)])]
  if (parsed.deadline) patch.deadline = parsed.deadline
  if (parsed.rrule) patch.rrule = parsed.rrule
  if (parsed.horizon) patch.horizon = parsed.horizon
  if (parsed.estimate) patch.estimate = parsed.estimate
  if (parsed.notes) patch.notes = defaults.notes ? `${defaults.notes}\n\n${parsed.notes}` : parsed.notes

  if (parsed.time) {
    const day = patch.due_date ?? today
    const start = localDateTimeToIso(day, parsed.time)
    patch.due_date = day
    patch.start_at = start
    patch.end_at = plusMinutesIso(start, parsed.durationMin ?? parsed.estimate ?? 60)
    patch.timezone = deviceTimeZone()
  } else if (parsed.dueDate && defaults.start_at && defaults.end_at) {
    // Vorgabe-Zeitblock (z. B. Klick in den Kalender) auf den genannten Tag schieben
    Object.assign(patch, moveBlockToDate(defaults.start_at, defaults.end_at, defaults.timezone ?? deviceTimeZone(), parsed.dueDate))
  }
  return { parsed, patch, matchedList: parsed.list, newListName: parsed.listName && !parsed.list ? parsed.listName : undefined }
}

export interface Applied {
  parsed: Parsed
  patch: TaskPatch
  newListName?: string
  /** kurze Beschreibung der erkannten Änderungen */
  labels: string[]
}

/** Neuen Titel einer bestehenden Aufgabe auswerten: nur was erkannt wurde, ändert sich */
export function applyToTask(task: Task, text: string, lists: Record<string, List>, tasks: Record<string, Task>): Applied {
  const today = todayStr()
  const parsed = parseLang(text, { today, lists, tasks, self: task.id })
  const patch: TaskPatch = { title: parsed.title || task.title }
  const tz = task.timezone ?? deviceTimeZone()

  if (parsed.time) {
    const day = parsed.dueDate ?? task.due_date ?? today
    const start = localDateTimeToIso(day, parsed.time)
    const keep = task.start_at && task.end_at ? minutesBetween(task.start_at, task.end_at) : null
    patch.start_at = start
    patch.end_at = plusMinutesIso(start, parsed.durationMin ?? parsed.estimate ?? keep ?? task.estimate ?? 60)
    patch.timezone = tz
    patch.due_date = day
  } else if (parsed.dueDate) {
    if (task.start_at && task.end_at) Object.assign(patch, moveBlockToDate(task.start_at, task.end_at, tz, parsed.dueDate), { timezone: tz })
    else patch.due_date = parsed.dueDate
  }
  if (parsed.deadline) patch.deadline = parsed.deadline
  if (parsed.priority !== undefined) patch.priority = parsed.priority
  if (parsed.horizon) patch.horizon = parsed.horizon
  if (parsed.rrule) {
    patch.rrule = parsed.rrule
    if (!patch.due_date && !task.due_date) patch.due_date = parsed.dueDate ?? today
  }
  if (parsed.estimate) patch.estimate = parsed.estimate
  if (parsed.tags.length) patch.tags = [...new Set([...task.tags, ...parsed.tags])]
  if (parsed.list) patch.list_id = parsed.list.id
  if (parsed.parent) {
    const below = new Set(descendantIds(tasks, task.id))
    if (!below.has(parsed.parent.id)) patch.parent_id = parsed.parent.id
  }
  if (parsed.waitFor.length) {
    const add = parsed.waitFor.map((w) => w.id).filter((id) => !wouldCycle(tasks, task.id, id))
    if (add.length) patch.blocked_by = [...new Set([...task.blocked_by, ...add])]
  }
  if (parsed.notes) patch.notes = task.notes ? `${task.notes}\n\n${parsed.notes}` : parsed.notes
  return { parsed, patch, labels: parsed.tokens.map((t) => t.label), newListName: parsed.listName && !parsed.list ? parsed.listName : undefined }
}

/** Suche: Wörter in Titel/Notizen, #tag als Filter */
export function matchesSearch(t: { title: string; notes: string | null; tags: string[] }, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return s.split(/\s+/).every((w) => (w.startsWith('#') ? t.tags.some((tag) => tag.startsWith(w.slice(1))) : t.title.toLowerCase().includes(w) || (t.notes ?? '').toLowerCase().includes(w)))
}
