/**
 * Offline-fähige Änderungen.
 *
 * Jede Änderung ist eine „Operation“. Sie wirkt sofort lokal und landet in einer Warteschlange,
 * die nacheinander an den Server geht. Was die Oberfläche zeigt, ist immer:
 *   bestätigter Server-Stand  +  alle noch ausstehenden Operationen.
 * Ohne Netz bleibt die Warteschlange einfach liegen und wird später abgearbeitet.
 */
import { api, withOpId, type NewTaskBody } from './api'
import type { List, Prefs, Task, TaskPatch, Template, TemplateNode } from './types'
import { localDayOf } from './dates'
import { descendantIds } from './tree'
import { nextOccurrence } from '../../shared/recurrence'
import { moveBlockToDate } from '../../shared/tz'

export interface Data {
  tasks: Record<string, Task>
  lists: Record<string, List>
  templates: Record<string, Template>
  prefs: Prefs
}

export const emptyData = (): Data => ({ tasks: {}, lists: {}, templates: {}, prefs: {} })

type ListFields = Pick<List, 'id' | 'name' | 'color' | 'sort'>
type ListPatch = Partial<Pick<List, 'name' | 'color' | 'sort' | 'archived'>>

export type OpBody =
  | { kind: 'createTask'; body: NewTaskBody }
  | { kind: 'updateTask'; id: string; patch: TaskPatch }
  | { kind: 'setStatus'; ids: string[]; status: 'open' | 'done'; today: string }
  | { kind: 'deleteTask'; id: string }
  | { kind: 'restoreTasks'; ids: string[]; rows: Task[] }
  | { kind: 'createList'; list: ListFields }
  | { kind: 'updateList'; id: string; patch: ListPatch }
  | { kind: 'deleteList'; id: string }
  | { kind: 'saveTemplate'; id: string; create: boolean; name?: string; payload?: TemplateNode }
  | { kind: 'deleteTemplate'; id: string }
  | { kind: 'setPref'; key: keyof Prefs; value: unknown }

export type Op = OpBody & { opId: string; ts: string; tries?: number }

export const makeOp = (body: OpBody): Op => ({ ...body, opId: crypto.randomUUID(), ts: new Date().toISOString() } as Op)

/** So wie der Server abgeleitete Felder setzt */
export function normalizeTask(t: Task): Task {
  const out = { ...t }
  if (out.start_at && out.timezone) out.due_date = localDayOf(out.start_at)
  if (out.status === 'done' && !out.completed_at) out.completed_at = new Date().toISOString()
  if (out.status === 'open') out.completed_at = null
  return out
}

export function newTaskFrom(body: NewTaskBody, ts: string): Task {
  return normalizeTask({
    list_id: null,
    parent_id: null,
    notes: null,
    status: 'open',
    priority: 4,
    horizon: 'backlog',
    tags: [],
    due_date: null,
    start_at: null,
    end_at: null,
    timezone: null,
    rrule: null,
    rollover_count: 0,
    completed_at: null,
    sort: Date.now(),
    gcal_event_id: null,
    gcal_etag: null,
    origin_event_id: null,
    deadline: null,
    blocked_by: [],
    num: null,
    estimate: null,
    gtask_id: null,
    created_at: ts,
    updated_at: ts,
    ...body,
  } as Task)
}

/** Lokale Wirkung einer Operation (ohne Seiteneffekte, kopiert nur, was sich ändert) */
export function applyOp(d: Data, op: Op): Data {
  switch (op.kind) {
    case 'createTask': {
      if (d.tasks[op.body.id]) return d
      return { ...d, tasks: { ...d.tasks, [op.body.id]: newTaskFrom(op.body, op.ts) } }
    }
    case 'updateTask': {
      const t = d.tasks[op.id]
      if (!t) return d
      return { ...d, tasks: { ...d.tasks, [op.id]: normalizeTask({ ...t, ...op.patch } as Task) } }
    }
    case 'setStatus': {
      const tasks = { ...d.tasks }
      if (op.status === 'open') {
        for (const id of op.ids) if (tasks[id]) tasks[id] = { ...tasks[id], status: 'open', completed_at: null }
        return { ...d, tasks }
      }
      const reopen = new Set<string>()
      const skip = new Set<string>()
      for (const id of op.ids) {
        const t = tasks[id]
        if (!t || !t.rrule || t.status !== 'open') continue
        const next = nextOccurrence(t.rrule, t.due_date ?? op.today, op.today)
        if (!next) continue
        let moved: Partial<Task> = { due_date: next }
        if (t.start_at && t.end_at && t.timezone) moved = { ...moveBlockToDate(t.start_at, t.end_at, t.timezone, next), due_date: next }
        tasks[id] = { ...t, ...moved, rollover_count: 0 }
        skip.add(id)
        for (const k of descendantIds(tasks, id)) reopen.add(k)
      }
      for (const id of reopen) if (tasks[id]) tasks[id] = { ...tasks[id], status: 'open', completed_at: null }
      for (const id of op.ids) {
        if (skip.has(id) || reopen.has(id) || !tasks[id]) continue
        tasks[id] = { ...tasks[id], status: 'done', completed_at: tasks[id].completed_at ?? op.ts }
      }
      return { ...d, tasks }
    }
    case 'deleteTask': {
      if (!d.tasks[op.id]) return d
      const tasks = { ...d.tasks }
      for (const id of [op.id, ...descendantIds(d.tasks, op.id)]) delete tasks[id]
      return { ...d, tasks }
    }
    case 'restoreTasks': {
      const tasks = { ...d.tasks }
      for (const r of op.rows) if (!tasks[r.id]) tasks[r.id] = r
      return { ...d, tasks }
    }
    case 'createList':
      if (d.lists[op.list.id]) return d
      return { ...d, lists: { ...d.lists, [op.list.id]: { archived: false, created_at: op.ts, updated_at: op.ts, ...op.list } } }
    case 'updateList': {
      const l = d.lists[op.id]
      if (!l) return d
      return { ...d, lists: { ...d.lists, [op.id]: { ...l, ...op.patch } } }
    }
    case 'deleteList': {
      if (!d.lists[op.id]) return d
      const lists = { ...d.lists }
      delete lists[op.id]
      const tasks = Object.fromEntries(Object.entries(d.tasks).map(([k, t]) => [k, t.list_id === op.id ? { ...t, list_id: null } : t]))
      return { ...d, lists, tasks }
    }
    case 'saveTemplate': {
      const cur = d.templates[op.id]
      if (!cur && !op.create) return d
      const next: Template = cur
        ? { ...cur, ...(op.name ? { name: op.name } : {}), ...(op.payload ? { payload: op.payload } : {}) }
        : { id: op.id, name: op.name ?? 'Vorlage', payload: op.payload ?? { title: op.name ?? 'Vorlage' }, created_at: op.ts, updated_at: op.ts }
      return { ...d, templates: { ...d.templates, [op.id]: next } }
    }
    case 'deleteTemplate': {
      if (!d.templates[op.id]) return d
      const templates = { ...d.templates }
      delete templates[op.id]
      return { ...d, templates }
    }
    case 'setPref':
      return { ...d, prefs: { ...d.prefs, [op.key]: op.value } }
  }
}

/** Was der Server bestätigt hat – wird in den bestätigten Stand übernommen */
export interface Effect {
  tasks?: Task[]
  removeTasks?: string[]
  lists?: List[]
  removeLists?: string[]
  templates?: Template[]
  removeTemplates?: string[]
  prefs?: Prefs
  advanced?: { id: string; next: string }[]
}

export const sendOp = (op: Op): Promise<Effect> => withOpId(op.opId, () => send(op))

async function send(op: Op): Promise<Effect> {
  switch (op.kind) {
    case 'createTask':
      return { tasks: [await api.createTask(op.body)] }
    case 'updateTask':
      return { tasks: [await api.updateTask(op.id, op.patch)] }
    case 'setStatus': {
      const r = await api.setStatus(op.ids, op.status, op.today)
      return { tasks: r.tasks, advanced: r.advanced }
    }
    case 'deleteTask':
      return { removeTasks: (await api.deleteTask(op.id)).ids }
    case 'restoreTasks':
      return { tasks: (await api.restoreTasks(op.ids)).tasks }
    case 'createList':
      return { lists: [await api.createList(op.list)] }
    case 'updateList':
      return { lists: [await api.updateList(op.id, op.patch)] }
    case 'deleteList':
      await api.deleteList(op.id)
      return { removeLists: [op.id] }
    case 'saveTemplate':
      return { templates: [await api.saveTemplate(op.id, op.create, { name: op.name, payload: op.payload })] }
    case 'deleteTemplate':
      await api.deleteTemplate(op.id)
      return { removeTemplates: [op.id] }
    case 'setPref':
      await api.setPref(op.key, op.value)
      return { prefs: { [op.key]: op.value } as Prefs }
  }
}

export function mergeEffect(base: Data, e: Effect): Data {
  const tasks = { ...base.tasks }
  for (const t of e.tasks ?? []) tasks[t.id] = t
  for (const id of e.removeTasks ?? []) delete tasks[id]
  const lists = { ...base.lists }
  for (const l of e.lists ?? []) lists[l.id] = l
  for (const id of e.removeLists ?? []) {
    delete lists[id]
    for (const [k, t] of Object.entries(tasks)) if (t.list_id === id) tasks[k] = { ...t, list_id: null }
  }
  const templates = { ...base.templates }
  for (const t of e.templates ?? []) templates[t.id] = t
  for (const id of e.removeTemplates ?? []) delete templates[id]
  return { tasks, lists, templates, prefs: { ...base.prefs, ...(e.prefs ?? {}) } }
}

// ---------------------------------------------------------------------------
// Speicher auf dem Gerät
// ---------------------------------------------------------------------------
const CACHE = 'organizer:cache:v1'
const OUTBOX = 'organizer:outbox:v1'

export function loadCache(): { base: Data; cursor: number } | null {
  try {
    const raw = localStorage.getItem(CACHE)
    if (!raw) return null
    const c = JSON.parse(raw) as { base: Data; cursor: number }
    return { base: { ...emptyData(), ...c.base }, cursor: c.cursor ?? 0 }
  } catch {
    return null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
export function saveCache(base: Data, cursor: number) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CACHE, JSON.stringify({ base, cursor, savedAt: Date.now() }))
    } catch {
      /* Speicher voll o. Ä. – dann eben ohne Cache */
    }
  }, 400)
}

export function loadOutbox(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]') as Op[]
  } catch {
    return []
  }
}

export function saveOutbox(ops: Op[]) {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(ops))
  } catch {
    /* egal */
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(CACHE)
    localStorage.removeItem(OUTBOX)
  } catch {
    /* egal */
  }
}
