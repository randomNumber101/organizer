import type { List, Task, TaskPatch, View } from './types'
import { HORIZON_LABEL } from './types'
import { format, parseISO } from 'date-fns'
import { de } from 'date-fns/locale'
import { addDaysStr, dayLabel, longDayLabel, todayStr, toDateStr } from './dates'
import { compareTasks } from './tree'

export interface Section {
  key: string
  title: string
  subtitle?: string
  tasks: Task[]
  showDate?: boolean
  overdue?: boolean
  addDefaults?: TaskPatch
  collapsible?: boolean
  muted?: boolean
}

/** Nur Aufgaben, deren Eltern nicht selbst in der Menge sind (die erscheinen verschachtelt darunter) */
function roots(list: Task[]): Task[] {
  const ids = new Set(list.map((t) => t.id))
  return list.filter((t) => !t.parent_id || !ids.has(t.parent_id)).sort(compareTasks)
}

export function viewTitle(view: View, lists: Record<string, List>): string {
  switch (view.kind) {
    case 'today':
      return 'Heute'
    case 'upcoming':
      return 'Demnächst'
    case 'horizon':
      return HORIZON_LABEL[view.horizon]
    case 'list':
      return lists[view.listId]?.name ?? 'Liste'
    case 'tag':
      return `#${view.tag}`
    case 'done':
      return 'Erledigt'
  }
}

export function viewDefaults(view: View): TaskPatch {
  switch (view.kind) {
    case 'today':
      return { due_date: todayStr() }
    case 'horizon':
      return { horizon: view.horizon }
    case 'list':
      return { list_id: view.listId }
    case 'tag':
      return { tags: [view.tag] }
    default:
      return {}
  }
}

export function buildSections(view: View, tasks: Record<string, Task>): Section[] {
  const all = Object.values(tasks)
  const open = all.filter((t) => t.status === 'open')
  const today = todayStr()

  switch (view.kind) {
    case 'today': {
      const overdue = open.filter((t) => t.due_date && t.due_date < today)
      const due = open.filter((t) => t.due_date === today)
      const doneToday = all.filter((t) => t.status === 'done' && t.completed_at && toDateStr(new Date(t.completed_at)) === today)
      const out: Section[] = []
      if (overdue.length) out.push({ key: 'overdue', title: 'Überfällig', tasks: roots(overdue), showDate: true, overdue: true })
      out.push({ key: 'today', title: longDayLabel(today), tasks: roots(due), addDefaults: { due_date: today } })
      if (doneToday.length) out.push({ key: 'done-today', title: `Heute erledigt (${doneToday.length})`, tasks: roots(doneToday), collapsible: true, muted: true })
      return out
    }
    case 'upcoming': {
      const out: Section[] = []
      for (let i = 1; i <= 7; i++) {
        const day = addDaysStr(today, i)
        out.push({
          key: day,
          title: i <= 2 ? dayLabel(day, today) : format(parseISO(day), 'EEEE', { locale: de }),
          subtitle: format(parseISO(day), i <= 2 ? 'EEEE, d. MMMM' : 'd. MMMM', { locale: de }),
          tasks: roots(open.filter((t) => t.due_date === day)),
          addDefaults: { due_date: day },
        })
      }
      const later = open.filter((t) => t.due_date && t.due_date > addDaysStr(today, 7))
      if (later.length) out.push({ key: 'later', title: 'Später', tasks: roots(later).sort((a, b) => a.due_date!.localeCompare(b.due_date!)), showDate: true })
      return out
    }
    case 'horizon': {
      const items = open.filter((t) => t.horizon === view.horizon && !t.due_date)
      return [{ key: view.horizon, title: '', tasks: roots(items), addDefaults: { horizon: view.horizon } }]
    }
    case 'list': {
      const inList = open.filter((t) => t.list_id === view.listId)
      const dated = roots(inList.filter((t) => t.due_date)).sort((a, b) => a.due_date!.localeCompare(b.due_date!) || compareTasks(a, b))
      const out: Section[] = []
      if (dated.length) out.push({ key: 'dated', title: 'Geplant', tasks: dated, showDate: true })
      for (const h of ['short', 'long', 'backlog'] as const) {
        out.push({
          key: h,
          title: HORIZON_LABEL[h],
          tasks: roots(inList.filter((t) => !t.due_date && t.horizon === h)),
          addDefaults: { list_id: view.listId, horizon: h },
        })
      }
      return out
    }
    case 'tag': {
      const items = open.filter((t) => t.tags.includes(view.tag))
      return [{ key: 'tag', title: '', tasks: roots(items), showDate: true, addDefaults: { tags: [view.tag] } }]
    }
    case 'done': {
      const done = all
        .filter((t) => t.status === 'done' && t.completed_at)
        .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))
      const groups = new Map<string, Task[]>()
      for (const t of done) {
        const d = toDateStr(new Date(t.completed_at!))
        if (!groups.has(d)) groups.set(d, [])
        groups.get(d)!.push(t)
      }
      return [...groups.entries()].map(([d, ts]) => ({ key: d, title: dayLabel(d, today), tasks: ts, muted: true }))
    }
  }
}

export function counts(tasks: Record<string, Task>) {
  const today = todayStr()
  const open = Object.values(tasks).filter((t) => t.status === 'open')
  const c = { today: 0, upcoming: 0, short: 0, long: 0, backlog: 0, lists: {} as Record<string, number>, tags: {} as Record<string, number> }
  const in7 = addDaysStr(today, 7)
  for (const t of open) {
    if (t.due_date && t.due_date <= today) c.today++
    else if (t.due_date && t.due_date <= in7) c.upcoming++
    if (!t.due_date) c[t.horizon]++
    if (t.list_id) c.lists[t.list_id] = (c.lists[t.list_id] ?? 0) + 1
    for (const tag of t.tags) c.tags[tag] = (c.tags[tag] ?? 0) + 1
  }
  return c
}
