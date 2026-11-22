import type { Task } from './types'

/** Offene Aufgaben, auf die diese Aufgabe noch wartet (gelöschte/unbekannte zählen nicht) */
export function openBlockers(tasks: Record<string, Task>, t: Task): Task[] {
  if (!t.blocked_by?.length) return []
  return t.blocked_by.map((id) => tasks[id]).filter((b): b is Task => !!b && b.status === 'open')
}

export const isBlocked = (tasks: Record<string, Task>, t: Task) => t.status === 'open' && openBlockers(tasks, t).length > 0

/** Aufgaben, die auf t warten */
export function dependents(tasks: Record<string, Task>, id: string): Task[] {
  return Object.values(tasks).filter((t) => t.blocked_by?.includes(id))
}

/** Würde „id wartet auf candidate“ einen Kreis erzeugen? */
export function wouldCycle(tasks: Record<string, Task>, id: string, candidate: string): boolean {
  if (id === candidate) return true
  const seen = new Set<string>()
  const stack = [candidate]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === id) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const b of tasks[cur]?.blocked_by ?? []) stack.push(b)
  }
  return false
}

/** Aufgaben, die durch das Erledigen von doneIds gerade frei geworden sind */
export function newlyFreed(before: Record<string, Task>, after: Record<string, Task>, doneIds: string[]): Task[] {
  const done = new Set(doneIds)
  return Object.values(after).filter((t) => t.status === 'open' && t.blocked_by?.some((b) => done.has(b)) && isBlocked(before, before[t.id] ?? t) && !isBlocked(after, t))
}
