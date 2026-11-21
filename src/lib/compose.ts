import { parseQuickAdd, type ParsedQuickAdd } from './quickadd'
import { deviceTimeZone, localDateTimeToIso, plusMinutesIso, todayStr } from './dates'
import type { List, TaskPatch } from './types'

export interface Composed {
  parsed: ParsedQuickAdd
  patch: TaskPatch & { title: string }
  /** Liste per @name angegeben, gibt es aber noch nicht */
  newListName?: string
  matchedList?: List
}

/** Text aus der Schnelleingabe + Vorgaben der Stelle (Spalte, Tag …) → neue Aufgabe */
export function composeTask(text: string, defaults: TaskPatch, lists: Record<string, List>): Composed {
  const parsed = parseQuickAdd(text, todayStr())
  const matchedList = parsed.listName ? Object.values(lists).find((l) => l.name.toLowerCase().startsWith(parsed.listName!.toLowerCase())) : undefined
  const patch: TaskPatch & { title: string } = {
    ...defaults,
    title: parsed.title,
    priority: parsed.priority ?? defaults.priority ?? 4,
    tags: [...new Set([...(defaults.tags ?? []), ...parsed.tags])],
    list_id: matchedList?.id ?? defaults.list_id ?? null,
    due_date: parsed.dueDate ?? defaults.due_date ?? null,
  }
  if (parsed.time && patch.due_date) {
    const start = localDateTimeToIso(patch.due_date, parsed.time)
    patch.start_at = start
    patch.end_at = plusMinutesIso(start, parsed.durationMin ?? 60)
    patch.timezone = deviceTimeZone()
  }
  return { parsed, patch, matchedList, newListName: parsed.listName && !matchedList ? parsed.listName : undefined }
}

/** Suche: Wörter in Titel/Notizen, #tag als Filter */
export function matchesSearch(t: { title: string; notes: string | null; tags: string[] }, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return s.split(/\s+/).every((w) => (w.startsWith('#') ? t.tags.some((tag) => tag.startsWith(w.slice(1))) : t.title.toLowerCase().includes(w) || (t.notes ?? '').toLowerCase().includes(w)))
}
