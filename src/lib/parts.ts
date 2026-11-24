/**
 * Teilaufgaben: eine große Aufgabe in Teile (Sitzungen) zerlegen – z. B. 2 h „Bericht schreiben“
 * als Teil 1 (1 h, heute) und Teil 2 (1 h, morgen). Die Teile sind Unteraufgaben mit part_index;
 * die Hauptaufgabe wird zum Rahmen (ohne eigenen Tag) und ist erledigt, wenn alle Teile erledigt sind.
 */
import type { Task } from './types'

export const isPart = (t: Task | undefined | null): boolean => !!t && t.part_index != null && !!t.parent_id

/** Teile einer Aufgabe, in ihrer Reihenfolge */
export function partsOf(tasks: Record<string, Task>, parentId: string): Task[] {
  return Object.values(tasks)
    .filter((t) => t.parent_id === parentId && t.part_index != null)
    .sort((a, b) => a.part_index! - b.part_index! || a.created_at.localeCompare(b.created_at))
}

export const hasParts = (tasks: Record<string, Task>, id: string): boolean => Object.values(tasks).some((t) => t.parent_id === id && t.part_index != null)

export interface PartInfo {
  /** 1-basiert, in der Reihenfolge der Teile */
  index: number
  count: number
  parent: Task | undefined
  parts: Task[]
}

export function partInfo(tasks: Record<string, Task>, t: Task): PartInfo | null {
  if (!isPart(t)) return null
  const parts = partsOf(tasks, t.parent_id!)
  return { index: parts.findIndex((p) => p.id === t.id) + 1, count: parts.length, parent: tasks[t.parent_id!], parts }
}

/** Fortschritt einer aufgeteilten Aufgabe (Teile + Minuten) */
export function partProgress(tasks: Record<string, Task>, id: string): { done: number; total: number; doneMin: number; totalMin: number } | null {
  const parts = partsOf(tasks, id)
  if (!parts.length) return null
  let doneMin = 0
  let totalMin = 0
  for (const p of parts) {
    totalMin += p.estimate ?? 0
    if (p.status === 'done') doneMin += p.estimate ?? 0
  }
  return { done: parts.filter((p) => p.status === 'done').length, total: parts.length, doneMin, totalMin }
}

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5)

/** Dauer halbieren (auf 5 min gerundet); unter 10 min bleibt alles beim ersten Teil */
export function halve(estimate: number | null): [number | null, number | null] {
  if (!estimate) return [null, null]
  if (estimate < 10) return [estimate, null]
  const a = round5(estimate / 2)
  return [a, Math.max(5, estimate - a)]
}

/** Wie viel bleibt, wenn man `worked` Minuten geschafft hat */
export function remaining(estimate: number | null, worked: number): number | null {
  if (!estimate) return null
  const r = estimate - worked
  return r > 0 ? round5(r) : 0
}
