import { create } from 'zustand'
import { ApiError, api, connectLive, setUnauthorizedHandler } from './lib/api'
import type { SyncResult } from './lib/api'
import type { List, Task, TaskPatch, View } from './lib/types'
import { deviceTimeZone, localDayOf, minutesBetween, plusMinutesIso, todayStr } from './lib/dates'
import { descendantIds } from './lib/tree'

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
  /** null = wird geprüft */
  authed: boolean | null
  loaded: boolean
  lists: Record<string, List>
  tasks: Record<string, Task>
  view: View
  selectedId: string | null
  drawerOpen: boolean
  quickAdd: { open: boolean; defaults: TaskPatch }
  toast: Toast | null
  connected: boolean
  collapsed: Record<string, boolean>

  initAuth: () => void
  login: (password: string) => Promise<string | null>
  signOut: () => Promise<void>
  loadAll: () => Promise<void>
  syncChanges: () => Promise<void>
  setView: (v: View) => void
  select: (id: string | null) => void
  setDrawer: (open: boolean) => void
  openQuickAdd: (defaults?: TaskPatch) => void
  closeQuickAdd: () => void
  showToast: (msg: string, kind?: Toast['kind'], undo?: () => void) => void
  toggleCollapsed: (id: string) => void

  createTask: (input: NewTask) => Promise<Task | null>
  updateTask: (id: string, patch: TaskPatch) => Promise<void>
  toggleDone: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  moveToDay: (id: string, day: string | null) => Promise<void>

  createList: (name: string, color: string) => Promise<List | null>
  updateList: (id: string, patch: Partial<Pick<List, 'name' | 'color' | 'sort' | 'archived'>>) => Promise<void>
  deleteList: (id: string) => Promise<void>
}

let stopLive: (() => void) | null = null
let initialized = false
let lastLoad = 0
let toastSeq = 0
let cursor = 0
let syncing: Promise<void> | null = null
let syncAgain = false
/** Aufgaben mit laufender Änderung: Sync-Ergebnisse überschreiben sie nicht (sonst flackert die Oberfläche) */
const inflight = new Map<string, number>()

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

/** Lokal nachbilden, was der Server ableitet, damit die Oberfläche sofort stimmt */
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
      // laufende lokale Änderungen behalten
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
    set({ authed: false, lists: {}, tasks: {}, loaded: false, connected: false, selectedId: null })
  }

  return {
    authed: null,
    loaded: false,
    lists: {},
    tasks: {},
    view: { kind: 'today' },
    selectedId: null,
    drawerOpen: false,
    quickAdd: { open: false, defaults: {} },
    toast: null,
    connected: false,
    collapsed: {},

    initAuth: () => {
      if (initialized) return
      initialized = true
      setUnauthorizedHandler(() => get().authed && endSession())
      api
        .me()
        .then(() => startSession())
        .catch((e) => {
          endSession()
          // offline o. Ä.: Hinweis zeigen; sobald wieder online, wird automatisch neu geprüft
          if (!(e instanceof ApiError && e.status === 401)) get().showToast(msg(e), 'error')
        })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && get().authed && Date.now() - lastLoad > 30_000) void get().loadAll()
      })
      window.addEventListener('online', () => {
        if (get().authed) void get().loadAll()
        else api.me().then(() => startSession()).catch(() => undefined)
      })
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
        // Übertrag: unerledigte Tagesaufgaben aus der Vergangenheit auf heute
        const roll = await api.rollover(todayStr())
        const r = await api.sync(0)
        applySync(r)
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

    setView: (view) => set({ view, drawerOpen: false, selectedId: null }),
    select: (selectedId) => set({ selectedId }),
    setDrawer: (drawerOpen) => set({ drawerOpen }),
    openQuickAdd: (defaults = {}) => set({ quickAdd: { open: true, defaults } }),
    closeQuickAdd: () => set({ quickAdd: { open: false, defaults: {} } }),
    toggleCollapsed: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),

    showToast: (text, kind = 'info', undo) => {
      const id = ++toastSeq
      set({ toast: { id, msg: text, kind, undo } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, kind === 'error' ? 6000 : 4500)
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
        created_at: now,
        updated_at: now,
        ...input,
      })
      set((s) => ({ tasks: { ...s.tasks, [task.id]: task } }))
      const release = hold([task.id])
      const { id, title, list_id, parent_id, notes, status, priority, horizon, tags, due_date, start_at, end_at, timezone, rrule, sort } = task
      try {
        const saved = await api.createTask({ id, title, list_id, parent_id, notes, status, priority, horizon, tags, due_date, start_at, end_at, timezone, rrule, sort })
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
      // Erledigen schließt offene Unteraufgaben mit ab
      const ids = [id, ...descendantIds(tasks, id).filter((d) => tasks[d]?.status === 'open')]
      const prev = ids.map((i) => tasks[i])
      const now = new Date().toISOString()
      set((s) => {
        const next = { ...s.tasks }
        for (const i of ids) next[i] = { ...next[i], status: 'done', completed_at: now }
        return { tasks: next }
      })
      const release = hold(ids)
      try {
        const r = await api.setStatus(ids, 'done')
        set((s) => ({ tasks: { ...s.tasks, ...byId(r.tasks) } }))
      } catch (e) {
        set((s) => ({ tasks: { ...s.tasks, ...byId(prev) } }))
        get().showToast(`Fehlgeschlagen: ${msg(e)}`, 'error')
        return
      } finally {
        release()
      }
      get().showToast(`„${task.title}“ erledigt`, 'info', () => {
        set((s) => ({ tasks: { ...s.tasks, ...byId(prev) } }))
        const rel = hold(ids)
        api
          .setStatus(ids, 'open')
          .then((r) => set((s) => ({ tasks: { ...s.tasks, ...byId(r.tasks) } })))
          .catch((e) => get().showToast(`Rückgängig fehlgeschlagen: ${msg(e)}`, 'error'))
          .finally(rel)
      })
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
        // gleiche Uhrzeit, neuer Tag
        const start = new Date(t.start_at)
        const [y, m, d] = day.split('-').map(Number)
        start.setFullYear(y, m - 1, d)
        const startIso = start.toISOString()
        await get().updateTask(id, {
          start_at: startIso,
          end_at: plusMinutesIso(startIso, minutesBetween(t.start_at, t.end_at)),
          timezone: deviceTimeZone(),
        })
        return
      }
      await get().updateTask(id, { due_date: day })
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
      set((s) => {
        const lists = { ...s.lists }
        delete lists[id]
        const tasks = Object.fromEntries(Object.entries(s.tasks).map(([k, t]) => [k, t.list_id === id ? { ...t, list_id: null } : t]))
        return { lists, tasks, view: s.view.kind === 'list' && s.view.listId === id ? { kind: 'today' } : s.view }
      })
      try {
        await api.deleteList(id)
      } catch (e) {
        set({ lists: prevLists, tasks: prevTasks })
        get().showToast(`Löschen fehlgeschlagen: ${msg(e)}`, 'error')
      }
    },
  }
})
