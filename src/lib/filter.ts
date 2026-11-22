import type { Task, TaskFilter } from './types'
import { addDaysStr, todayStr } from './dates'
import { isBlocked } from './blocking'

export type DeadlineState = 'overdue' | 'today' | 'soon' | 'later'

/** Wie dringend ist die Frist? „soon“ = innerhalb der nächsten 3 Tage */
export const deadlineDay = (deadline: string) => deadline.slice(0, 10)
export const deadlineTime = (deadline: string) => (deadline.length > 10 ? deadline.slice(11, 16) : null)

export function deadlineState(deadline: string, today = todayStr()): DeadlineState {
  const day = deadlineDay(deadline)
  if (day < today) return 'overdue'
  if (day === today) {
    const time = deadlineTime(deadline)
    if (time) {
      const now = new Date()
      const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      if (nowHm > time) return 'overdue'
    }
    return 'today'
  }
  if (day <= addDaysStr(today, 3)) return 'soon'
  return 'later'
}

export function isFilterActive(f: TaskFilter): boolean {
  return !!(f.lists?.length || f.tags?.length || f.priorities?.length || f.when || f.deadline || f.state)
}

export function filterCount(f: TaskFilter): number {
  return (f.lists?.length ? 1 : 0) + (f.tags?.length ? 1 : 0) + (f.priorities?.length ? 1 : 0) + (f.when ? 1 : 0) + (f.deadline ? 1 : 0) + (f.state ? 1 : 0)
}

/**
 * Passt eine Aufgabe zum Filter? Unteraufgaben werden über ihre oberste Aufgabe beurteilt,
 * damit Karten nicht auseinanderfallen.
 */
export function matchesFilter(t: Task, f: TaskFilter, tasks: Record<string, Task>, today = todayStr()): boolean {
  if (!isFilterActive(f)) return true
  if (f.lists?.length && !f.lists.includes(t.list_id ?? 'inbox')) return false
  if (f.tags?.length && !f.tags.some((tag) => t.tags.includes(tag))) return false
  if (f.priorities?.length && !f.priorities.includes(t.priority)) return false
  if (f.when) {
    const day = t.due_date
    if (f.when === 'nodate' && day) return false
    if (f.when === 'today' && !(day && (day === today || (day < today && t.status === 'open')))) return false
    if (f.when === 'overdue' && !(day && day < today && t.status === 'open')) return false
    if (f.when === 'week' && !(day && day <= addDaysStr(today, 6))) return false
  }
  if (f.deadline === 'any' && !t.deadline) return false
  if (f.deadline === 'soon' && !(t.deadline && deadlineDay(t.deadline) <= addDaysStr(today, 7))) return false
  if (f.state === 'blocked' && !isBlocked(tasks, t)) return false
  if (f.state === 'free' && isBlocked(tasks, t)) return false
  return true
}

export const WHEN_LABEL: Record<NonNullable<TaskFilter['when']>, string> = {
  overdue: 'Überfällig',
  today: 'Heute fällig',
  week: 'Nächste 7 Tage',
  nodate: 'Ohne Datum',
}

export function allTags(tasks: Record<string, Task>): string[] {
  const count = new Map<string, number>()
  for (const t of Object.values(tasks)) for (const tag of t.tags) count.set(tag, (count.get(tag) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag)
}
