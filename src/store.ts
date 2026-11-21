import { create } from 'zustand'
import { ApiError, api, connectLive, setUnauthorizedHandler } from './lib/api'
import type { SyncResult } from './lib/api'
import type { BoardMode, CalendarEvent, GoogleStatus, List, Task, TaskPatch, ViewName } from './lib/types'
import { addDaysStr, deviceTimeZone, isoFromDayMinutes, localDayOf, minutesBetween, shortDate, todayStr } from './lib/dates'
import { descendantIds } from './lib/tree'
import { load, save } from './lib/storage'
import { nextOccurrence } from '../shared/recurrence'
import { moveBlockToDate } from '../shared/tz'

interface Toast {
  id: number
  msg: string
  kind: 'info' | 'error'
  undo?: () => void
}

export interface NewTask extends TaskPatch {
  title: string
}

interface State {
  authed: boolean | null
  loaded: boolean
  lists: Record<string, List>
  tasks: Record<string, Task>
  connected: boolean

  view: ViewName
  boardMode: BoardMode
  /** Tag, den Planer und Kalender zeigen */
  focusDay: string
  selectedId: string | null
  quickAdd: { open: boolean; defaults: TaskPatch; hint?: string }
  triageOpen: boolean
  settingsOpen: boolean
  search: string
  toast: Toast | null
  expanded: Record<string, boolean>
  dragging: boolean

  google: GoogleStatus | null
  events: Record<string, CalendarEvent[]>
  eventsLoading: boolean

  initAuth: () => void
  login: (password: string) => Promise<string | null>
  signOut: () => Promise<void>
  loadAll: () => Promise<void>
  syncChanges: () => Promise<void>

  setView: (v: ViewName) => void
  setBoardMode: (m: BoardMode) => void
  setFocusDay: (d: string) => void
  select: (id: string | null) => void
  openQuickAdd: (defaults?: TaskPatch, hint?: string) => void
  closeQuickAdd: () => void
  setTriage: (open: boolean) => void
  setSettings: (open: boolean) => void
  setSearch: (q: string) => void
  showToast: (msg: string, kind?: Toast['kind'], undo?: () => void) => void
  toggleExpanded: (id: string) => void
  setDragging: (d: boolean) => void

  createTask: (input: NewTask) => Promise<Task | null>
  updateTask: (id: string, patch: TaskPatch) => Promise<void>
  toggleDone: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  moveToDay: (id: string, day: string | null) => Promise<void>
  schedule: (id: string, day: string, startMin: number, durationMin: number) => Promise<void>
  unschedule: (id: string) => Promise<void>

  createList: (name: string, color: string) => Promise<List | null>
  updateList: (id: string, patch: Partial<Pick<List, 'name' | 'color' | 'sort' | 'archived'>>) => Promise<void>
  deleteList: (id: string) => Promise<void>

  loadGoogle: () => Promise<void>
  loadEvents: (from: string, to: string, force?: boolean) => Promise<void>
  connectGoogle: () => void
  disconnectGoogle: () => Promise<void>
  setGoogleCalendars: (ids: string[]) => Promise<void>
  importEvent: (ev: CalendarEvent) => Promise<void>
}

let stopLive: (() => void) | null = null
let initialized = false
let lastLoad = 0
let toastSeq = 0
let cursor = 0
let syncing: Promise<void> | null = null
let syncAgain = false
const inflight = new Map<string, number>()
const eventRequests = new Map<string, number>()

const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, T>
const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))

function hold(ids: string[]) {
  for (const id of ids) inflight.set(id, (inflight.get(id) ?? 0) + 1)
  return () => {
    for (const id of ids) {
      const n = (inflight.get(id) ?? 1) - 1
      if (n <= 0) inflight.delete(id)
      else inflight.set(id, n)
    }
  }
}

function normalize(t: Task): Task {
  const out = { ...t }
  if (out.start_at && out.timezone) out.due_date = localDayOf(out.start_at)
  if (out.status === 'done' && !out.completed_at) out.completed_at = new Date().toISOString()
  if (out.status === 'open') out.completed_at = null
  return out
}

export const useStore = create<State>()((set, get) => {
  function applySync(r: SyncResult) {
    cursor = r.cursor
    if (r.full) {
      const keep = Object.fromEntries([...inflight.keys()].map((id) => [id, get().tasks[id]]).filter(([, t]) => t))
      set({ lists: byId(r.lists), tasks: { ...byId(r.tasks), ...keep }, loaded: true })
      return
    }
    set((s) => {
      const tasks = { ...s.tasks }
      for (const t of r.tasks) if (!inflight.has(t.id)) tasks[t.id] = t
      for (const id of r.deletedTaskIds) if (!inflight.has(id)) delete tasks[id]
      const lists = { ...s.lists }
      for (const l of r.lists) lists[l.id] = l
      for (const id of r.deletedListIds) delete lists[id]
      return { tasks, lists }
    })
  }

  function startSession() {
    set({ authed: true })
    void get().loadAll()
    void get().loadGoogle()
    stopLive?.()
    stopLive = connectLive(
      () => void get().syncChanges(),
      (connected) => set({ connected }),
    )
  }

  function endSession() {
    stopLive?.()
    stopLive = null
    cursor = 0
    set({ authed: false, lists: {}, tasks: {}, loaded: false, connected: false, selectedId: null, google: null, events: {} })
  }

  return {
    authed: null,
    loaded: false,
    lists: {},
    tasks: {},
    connected: false,

    view: load<ViewName>('view', 'board'),
    boardMode: load<BoardMode>('boardMode', 'lists'),
    focusDay: todayStr(),
    selectedId: null,
    quickAdd: { open: false, defaults: {} },
    triageOpen: false,
    settingsOpen: false,
    search: '',
    toast: null,
    expanded: {},
    dragging: false,

    google: null,
    events: {},
    eventsLoading: false,

    initAuth: () => {
      if (initialized) return
      initialized = true
      setUnauthorizedHandler(() => get().authed && endSession())
      api
        .me()
        .then(() => startSession())
        .catch((e) => {
          endSession()
          if (!(e instanceof ApiError && e.status === 401)) get().showToast(msg(e), 'error')
        })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !get().authed) return
        if (get().focusDay < todayStr()) set({ focusDay: todayStr() })
        if (Date.now() - lastLoad > 30_000) void get().loadAll()
      })
      window.addEventListener('online', () => {
        if (get().authed) void get().loadAll()
        else api.me().then(() => startSession()).catch(() => undefined)
      })

      // Rückkehr von der Google-Anmeldung
      const params = new URLSearchParams(location.search)
      const g = params.get('google')
      if (g) {
        history.replaceState(null, '', location.pathname)
        const text: Record<string, [string, 'info' | 'error']> = {
          connected: ['Google Kalender ist verbunden.', 'info'],
          'not-configured': ['Google ist im Worker noch nicht eingerichtet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).', 'error'],
          login: ['Bitte erst anmelden und dann Google erneut verbinden.', 'error'],
          error: [`Google-Verbindung fehlgeschlagen (${params.get('reason') ?? 'unbekannt'}).`, 'error'],
        }
        const [t, k] = text[g] ?? text.error
        setTimeout(() => get().showToast(t, k), 400)
        if (g === 'connected') set({ settingsOpen: true })
      }
    },

    login: async (password) => {
      try {
        await api.login(password)
        startSession()
        return null
      } catch (e) {
        return msg(e)
      }
    },

    signOut: async () => {
      await api.logout().catch(() => undefined)
      endSession()
    },

    loadAll: async () => {
      lastLoad = Date.now()
      try {
        const roll = await api.rollover(todayStr())
        applySync(await api.sync(0))
        if (roll.moved > 0) get().showToast(`${roll.moved} unerledigte ${roll.moved === 1 ? 'Aufgabe' : 'Aufgaben'} auf heute übertragen`)
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) get().showToast(`Laden fehlgeschlagen: ${msg(e)}`, 'error')
      }
    },

    syncChanges: async () => {
      if (!get().loaded) return
      if (syncing) {
        syncAgain = true
        return syncing
      }
      syncing = (async () => {
        do {
          syncAgain = false
          try {
            applySync(await api.sync(cursor))
          } catch (e) {
            console.warn('sync', e)
          }
        } while (syncAgain)
      })().finally(() => {
        syncing = null
      })
      return syncing
    },

    setView: (view) => {
      save('view', view)
      set({ view, selectedId: null })
    },
    setBoardMode: (boardMode) => {
      save('boardMode', boardMode)
      set({ boardMode })
    },
    setFocusDay: (focusDay) => set({ focusDay }),
    select: (selectedId) => set({ selectedId }),
    openQuickAdd: (defaults = {}, hint) => set({ quickAdd: { open: true, defaults, hint } }),
    closeQuickAdd: () => set({ quickAdd: { open: false, defaults: {} } }),
    setTriage: (triageOpen) => set({ triageOpen }),
    setSettings: (settingsOpen) => set({ settingsOpen }),
    setSearch: (search) => set({ search }),
    toggleExpanded: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
    setDragging: (dragging) => set({ dragging }),

    showToast: (text, kind = 'info', undo) => {
      const id = ++toastSeq
      set({ toast: { id, msg: text, kind, undo } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, kind === 'error' ? 6500 : undo ? 5500 : 3500)
    },

    createTask: async (input) => {
      const now = new Date().toISOString()
      const task = normalize({
        id: crypto.randomUUID(),
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
        timezone: input.start_at ? deviceTimeZone() : null,
        rrule: null,
        rollover_count: 0,
        completed_at: null,
        sort: Date.now(),
        gcal_event_id: null,
        gcal_etag: null,
        origin_event_id: null,
        created_at: now,
        updated_at: now,
        ...input,
      })
      set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }))
      const release = hold([task.id])
      const { id, title, list_id, parent_id, notes, status, priority, horizon, tags, due_date, start_at, end_at, timezone, rrule, sort, origin_event_id } = task
      try {
        const saved = await api.createTask({ id, title, list_id, parent_id, notes, status, priority, horizon, tags, due_date, start_at, end_at, timezone, rrule, sort, origin_event_id })
        set((s) => ({ tasks: { ...s.tasks, [saved.id]: saved } }))
        return saved
      } catch (e) {
        set((s) => {
          const tasks = { ...s.tasks }
          delete tasks[task.id]
          return { tasks }
        })
        get().showToast(`Speichern fehlgeschlagen: ${msg(e)}`, 'error')
        return null
      } finally {
        release()
      }
    },

    updateTask: async (id, patch) => {
      const prev = get().tasks[id]
      if (!prev) return
      const fullPatch: TaskPatch = { ...patch }
      if (patch.start_at && !prev.timezone && !patch.timezone) fullPatch.timezone = deviceTimeZone()
      if (patch.rrule && !prev.due_date && !patch.due_date) fullPatch.due_date = todayStr()
      set((s) => ({ tasks: { ...s.tasks, [id]: normalize({ ...prev, ...fullPatch }) } }))
      const release = hold([id])
      try {
        const saved = await api.updateTask(id, fullPatch)
        set((s) => ({ tasks: { ...s.tasks, [id]: saved } }))
      } catch (e) {
        set((s) => ({ tasks: { ...s.tasks, [id]: prev } }))
        get().showToast(`Änderung fehlgeschlagen: ${msg(e)}`, 'error')
      } finally {
        release()
      }
    },

    toggleDone: async (id) => {
      const { tasks } = get()
      const task = tasks[id]
      if (!task) return
      if (task.status === 'done') {
        await get().updateTask(id, { status: 'open' })
        return
      }
      const today = todayStr()
      const desc = descendantIds(tasks, id)
      const ids = [id, ...desc.filter((d) => tasks[d]?.status === 'open')]
      const prev = [task, ...desc.map((d) => tasks[d]).filter(Boolean)]
      const now = new Date().toISOString()

      // Optimistisch: wiederkehrende Aufgaben rücken vor, andere werden erledigt
      set((s) => {
        const next = { ...s.tasks }
        if (task.rrule) {
          const nd = nextOccurrence(task.rrule, task.due_date ?? today, today)
          if (nd) {
            let moved: Partial<Task> = { due_date: nd }
            if (task.start_at && task.end_at && task.timezone) moved = { ...moveBlockToDate(task.start_at, task.end_at, task.timezone, nd), due_date: nd }
            next[id] = { ...task, ...moved, rollover_count: 0 }
          }
          for (const d of desc) if (next[d]) next[d] = { ...next[d], status: 'open', completed_at: null }
        } else {
          for (const i of ids) next[i] = { ...next[i], status: 'done', completed_at: now }
        }
        return { tasks: next }
      })
      const release = hold([id, ...desc])
      let advanced: { id: string; next: string }[] = []
      try {
        const r = await api.setStatus(ids, 'done', today)
        advanced = r.advanced
        set((s) => ({ tasks: { ...s.tasks, ...byId(r.tasks) } }))
      } catch (e) {
        set((s) => ({ tasks: { ...s.tasks, ...byId(prev) } }))
        get().showToast(`Fehlgeschlagen: ${msg(e)}`, 'error')
        return
      } finally {
        release()
      }
      const adv = advanced.find((a) => a.id === id)
      const restore = () => {
        set((s) => ({ tasks: { ...s.tasks, ...byId(prev) } }))
        const rel = hold(prev.map((p) => p.id))
        const p = adv
          ? api.updateTask(id, { due_date: task.due_date, start_at: task.start_at, end_at: task.end_at, timezone: task.timezone }).then(async (t) => {
              const doneKids = prev.filter((x) => x.id !== id && x.status === 'done').map((x) => x.id)
              const r = doneKids.length ? await api.setStatus(doneKids, 'done', today) : { tasks: [] }
              set((s) => ({ tasks: { ...s.tasks, [t.id]: t, ...byId(r.tasks) } }))
            })
          : api.setStatus(ids, 'open', today).then((r) => set((s) => ({ tasks: { ...s.tasks, ...byId(r.tasks) } })))
        p.catch((e) => get().showToast(`Rückgängig fehlgeschlagen: ${msg(e)}`, 'error')).finally(rel)
      }
      get().showToast(adv ? `„${task.title}“ erledigt · nächstes Mal ${shortDate(adv.next)}` : `„${task.title}“ erledigt`, 'info', restore)
    },

    deleteTask: async (id) => {
      const { tasks } = get()
      const task = tasks[id]
      if (!task) return
      const ids = [id, ...descendantIds(tasks, id)]
      const removed = ids.map((i) => tasks[i]).filter(Boolean)
      set((s) => {
        const next = { ...s.tasks }
        for (const i of ids) delete next[i]
        return { tasks: next, selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId }
      })
      const release = hold(ids)
      let deletedIds: string[]
      try {
        deletedIds = (await api.deleteTask(id)).ids
      } catch (e) {
        set((s) => ({ tasks: { ...s.tasks, ...byId(removed) } }))
        get().showToast(`Löschen fehlgeschlagen: ${msg(e)}`, 'error')
        return
      } finally {
        release()
      }
      get().showToast(`„${task.title}“ gelöscht`, 'info', () => {
        set((s) => ({ tasks: { ...s.tasks, ...byId(removed) } }))
        const rel = hold(deletedIds)
        api
          .restoreTasks(deletedIds)
          .then((r) => set((s) => ({ tasks: { ...s.tasks, ...byId(r.tasks) } })))
          .catch((e) => get().showToast(`Wiederherstellen fehlgeschlagen: ${msg(e)}`, 'error'))
          .finally(rel)
      })
    },

    moveToDay: async (id, day) => {
      const t = get().tasks[id]
      if (!t) return
      if (day === null) {
        await get().updateTask(id, { due_date: null, start_at: null, end_at: null, timezone: null })
        return
      }
      if (t.start_at && t.end_at) {
        await get().updateTask(id, { ...moveBlockToDate(t.start_at, t.end_at, t.timezone ?? deviceTimeZone(), day), timezone: t.timezone ?? deviceTimeZone() })
        return
      }
      await get().updateTask(id, { due_date: day })
    },

    schedule: async (id, day, startMin, durationMin) => {
      const start = isoFromDayMinutes(day, startMin)
      const end = isoFromDayMinutes(day, startMin + durationMin)
      await get().updateTask(id, { start_at: start, end_at: end, timezone: deviceTimeZone() })
    },

    unschedule: async (id) => {
      const t = get().tasks[id]
      if (!t) return
      await get().updateTask(id, { start_at: null, end_at: null, timezone: null, due_date: t.due_date })
    },

    createList: async (name, color) => {
      const sort = Math.max(0, ...Object.values(get().lists).map((l) => l.sort)) + 1
      try {
        const list = await api.createList({ id: crypto.randomUUID(), name, color, sort })
        set((s) => ({ lists: { ...s.lists, [list.id]: list } }))
        return list
      } catch (e) {
        get().showToast(`Liste anlegen fehlgeschlagen: ${msg(e)}`, 'error')
        return null
      }
    },

    updateList: async (id, patch) => {
      const prev = get().lists[id]
      if (!prev) return
      set((s) => ({ lists: { ...s.lists, [id]: { ...prev, ...patch } } }))
      try {
        const saved = await api.updateList(id, patch)
        set((s) => ({ lists: { ...s.lists, [id]: saved } }))
      } catch (e) {
        set((s) => ({ lists: { ...s.lists, [id]: prev } }))
        get().showToast(`Änderung fehlgeschlagen: ${msg(e)}`, 'error')
      }
    },

    deleteList: async (id) => {
      const prevLists = get().lists
      const prevTasks = get().tasks
      const name = prevLists[id]?.name
      set((s) => {
        const lists = { ...s.lists }
        delete lists[id]
        const tasks = Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, t.list_id === id ? { ...t, list_id: null } : t]))
        return { lists, tasks }
      })
      try {
        await api.deleteList(id)
        get().showToast(`Liste „${name}“ gelöscht – ihre Aufgaben liegen jetzt in „Unsortiert“`)
      } catch (e) {
        set({ lists: prevLists, tasks: prevTasks })
        get().showToast(`Löschen fehlgeschlagen: ${msg(e)}`, 'error')
      }
    },

    loadGoogle: async () => {
      try {
        set({ google: await api.googleStatus() })
      } catch (e) {
        console.warn('google status', e)
        set({ google: { configured: false, connected: false } })
      }
    },

    loadEvents: async (from, to, force = false) => {
      const g = get().google
      if (!g?.connected || g.status !== 'ok') return
      const key = `${from}|${to}`
      const last = eventRequests.get(key) ?? 0
      if (!force && Date.now() - last < 60_000) return
      eventRequests.set(key, Date.now())
      set({ eventsLoading: true })
      try {
        const r = await api.googleEvents(from, to)
        set((s) => ({ events: { ...s.events, [key]: r.events } }))
      } catch (e) {
        eventRequests.delete(key)
        if (e instanceof ApiError && e.status === 409) void get().loadGoogle()
      } finally {
        set({ eventsLoading: false })
      }
    },

    connectGoogle: () => {
      location.href = '/api/google/connect'
    },

    disconnectGoogle: async () => {
      try {
        await api.googleDisconnect()
        set({ events: {} })
        eventRequests.clear()
        await get().loadGoogle()
        get().showToast('Google Kalender getrennt')
      } catch (e) {
        get().showToast(msg(e), 'error')
      }
    },

    setGoogleCalendars: async (ids) => {
      const g = get().google
      if (g?.calendars) set({ google: { ...g, calendars: g.calendars.map((c) => ({ ...c, selected: ids.includes(c.id) })) } })
      try {
        await api.googleCalendars(ids)
        eventRequests.clear()
        set({ events: {} })
      } catch (e) {
        get().showToast(msg(e), 'error')
        void get().loadGoogle()
      }
    },

    importEvent: async (ev) => {
      const exists = Object.values(get().tasks).find((t) => t.origin_event_id === ev.id)
      if (exists) {
        get().showToast('Diesen Termin hast du schon als Aufgabe')
        set({ selectedId: exists.id })
        return
      }
      const patch: NewTask = { title: ev.title, origin_event_id: ev.id, notes: ev.location ? `Ort: ${ev.location}` : null }
      if (ev.allDay) patch.due_date = ev.start
      else {
        patch.start_at = ev.start
        patch.end_at = minutesBetween(ev.start, ev.end) > 0 ? ev.end : new Date(Date.parse(ev.start) + 3_600_000).toISOString()
        patch.timezone = deviceTimeZone()
      }
      const t = await get().createTask(patch)
      if (t) get().showToast(`„${t.title}“ als Aufgabe übernommen`)
    },
  }
})

/** Termine für einen Zeitraum (inkl. aller geladenen Bereiche, die ihn überlappen) */
export function eventsFor(events: Record<string, CalendarEvent[]>, from: string, to: string): CalendarEvent[] {
  const seen = new Map<string, CalendarEvent>()
  for (const [key, list] of Object.entries(events)) {
    const [f, t] = key.split('|')
    if (t < from || f > to) continue
    for (const e of list) seen.set(`${e.calendarId}|${e.id}`, e)
  }
  return [...seen.values()]
}

export const nextDays = (n: number) => addDaysStr(todayStr(), n)
