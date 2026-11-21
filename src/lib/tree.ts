import type { Task } from './types'

export function childrenOf(tasks: Record<string, Task>, parentId: string): Task[] {
  return Object.values(tasks)
    .filter((t) => t.parent_id === parentId)
    .sort(compareTasks)
}

export function descendantIds(tasks: Record<string, Task>, id: string): string[] {
  const out: string[] = []
  const stack = [id]
  const all = Object.values(tasks)
  while (stack.length) {
    const cur = stack.pop()!
    for (const t of all) {
      if (t.parent_id === cur) {
        out.push(t.id)
        stack.push(t.id)
      }
    }
  }
  return out
}

/** Pfad der Eltern (oberste zuerst) */
export function ancestors(tasks: Record<string, Task>, task: Task): Task[] {
  const out: Task[] = []
  let cur = task.parent_id ? tasks[task.parent_id] : undefined
  let guard = 0
  while (cur && guard++ < 50) {
    out.unshift(cur)
    cur = cur.parent_id ? tasks[cur.parent_id] : undefined
  }
  return out
}

/** offene vor erledigten; Zeitblöcke nach Uhrzeit; dann Priorität; dann Sortierung/Erstellung */
export function compareTasks(a: Task, b: Task): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1
  if (a.start_at && b.start_at) return a.start_at.localeCompare(b.start_at)
  if (a.start_at) return -1
  if (b.start_at) return 1
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.sort !== b.sort) return a.sort - b.sort
  return a.created_at.localeCompare(b.created_at)
}

export function subtaskProgress(tasks: Record<string, Task>, id: string): { done: number; total: number } {
  const kids = Object.values(tasks).filter((t) => t.parent_id === id)
  return { done: kids.filter((k) => k.status === 'done').length, total: kids.length }
}
