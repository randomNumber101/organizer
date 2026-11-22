import { create } from 'zustand'
import { ApiError, api, connectLive, setUnauthorizedHandler } from './lib/api'
import type { SyncResult } from './lib/api'
import type { BoardMode, CalendarEvent, GoogleStatus, List, Prefs, SavedView, Task, TaskFilter, TaskPatch, Template, TemplateNode, ViewName } from './lib/types'
import { addDaysStr, deviceTimeZone, isoFromDayMinutes, minutesBetween, shortDate, todayStr } from './lib/dates'
import { childrenOf, compareTasks, descendantIds } from './lib/tree'
import { load, save } from './lib/storage'
import { moveBlockToDate } from '../shared/tz'
import { applyOp, clearLocal, emptyData, loadCache, loadOutbox, makeOp, mergeEffect, saveCache, saveOutbox, sendOp, type Data, type Op, type OpBody } from './lib/ops'
import { newlyFreed } from './lib/blocking'
import { refreshPush } from './lib/push'

interface Toast {
  id: number
  msg: string
  kind: 'info' | 'error'
  undo?: () => void
}

export interface NewTask extends TaskPatch {
  title: string
}

export type RitualKind = 'plan' | 'review'

interface State {
  authed: boolean | null
  loaded: boolean
  lists: Record<string, List>
  tasks: Record<string, Task>
  templates: Record<string, Template>
  prefs: Prefs
  connected: boolean
  /** letzter Versuch, den Server zu erreichen, ist gescheitert */
  offline: boolean
  /** Änderungen, die noch nicht beim Server sind */
  pending: number

  view: ViewName
  boardMode: BoardMode
  /** Tag, den Planer und Kalender zeigen */
  focusDay: string
  selectedId: string | null
  quickAdd: { open: boolean; defaults: TaskPatch; hint?: string; title?: string }
  triageOpen: boolean
  settingsOpen: boolean
  paletteOpen: boolean
  /** zählt jedes Öffnen hoch – die Palette startet dann immer frisch */
  paletteSeq: number
  ritual: RitualKind | null
  templatePicker: { defaults: TaskPatch } | null
  search: string
  filter: TaskFilter
  activeViewId: string | null
  filterOpen: boolean
  toast: Toast | null
  /** pro Aufgabe: Unteraufgaben auf- (true) oder zugeklappt (false); sonst gilt showSubtasks */
  expanded: Record<string, boolean>
  showSubtasks: boolean
  showNums: boolean
  dragging: boolean

  google: GoogleStatus | null
  events: Record<string, CalendarEvent[]>
  eventsLoading: boolean

  initAuth: () => void
  login: (password: string) => Promise<string | null>
  signOut: () => Promise<void>
  loadAll: () => Promise<void>
  syncChanges: () => Promise<void>
  retryNow: () => void

  setView: (v: ViewName) => void
  setBoardMode: (m: BoardMode) => void
  setFocusDay: (d: string) => void
  select: (id: string | null) => void
  openQuickAdd: (defaults?: TaskPatch, hint?: string, title?: string) => void
  closeQuickAdd: () => void
  setTriage: (open: boolean) => void
  setSettings: (open: boolean) => void
  setPalette: (open: boolean) => void
  openRitual: (kind: RitualKind | null) => void
  finishRitual: (kind: RitualKind) => void
  openTemplatePicker: (defaults?: TaskPatch | null) => void
  setSearch: (q: string) => void
  setFilter: (f: TaskFilter, viewId?: string | null) => void
  setFilterOpen: (open: boolean) => void
  applyView: (id: string | null) => void
  saveView: (name: string) => void
  deleteView: (id: string) => void
  showToast: (msg: string, kind?: Toast['kind'], undo?: () => void) => void
  toggleExpanded: (id: string) => void
  setShowSubtasks: (v: boolean) => void
  setShowNums: (v: boolean) => void
  setDragging: (d: boolean) => void

  createTask: (input: NewTask) => Task
  updateTask: (id: string, patch: TaskPatch) => void
  toggleDone: (id: string) => void
  deleteTask: (id: string) => void
  moveToDay: (id: string, day: string | null) => void
  schedule: (id: string, day: string, startMin: number, durationMin: number) => void
  unschedule: (id: string) => void
  setBlockers: (id: string, blockers: string[]) => void

  createList: (name: string, color: string) => List
  updateList: (id: string, patch: Partial<Pick<List, 'name' | 'color' | 'sort' | 'archived'>>) => void
  deleteList: (id: string) => void

  saveAsTemplate: (taskId: string, name: string) => void
  renameTemplate: (id: string, name: string) => void
  deleteTemplate: (id: string) => void
  useTemplate: (id: string, defaults?: TaskPatch) => Task | null
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void

  loadGoogle: () => Promise<void>
  refreshGoogle: () => Promise<void>
  loadEvents: (from: string, to: string, force?: boolean) => Promise<void>
  connectGoogle: () => void
  disconnectGoogle: () => Promise<void>
  setGoogleCalendars: (ids: string[]) => Promise<void>
  setGoogleTasks: (enabled: boolean) => Promise<boolean>
  importEvent: (ev: CalendarEvent) => void
}

let stopLive: (() => void) | null = null
let initialized = false
let lastLoad = 0
let toastSeq = 0
let syncing: Promise<void> | null = null
let syncAgain = false
const eventRequests = new Map<string, number>()

// bestätigter Server-Stand + Warteschlange
let base: Data = emptyData()
let cursor = 0
let outbox: Op[] = []
let flushing = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 2000

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))
const isNetwork = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500 || e.status === 429)

/** Server-Zeile nur übernehmen, wenn sie nicht älter ist als das, was wir schon haben */
function newer<T extends { updated_at: string }>(cur: T | undefined, incoming: T) {
  return !cur || incoming.updated_at >= cur.updated_at
}

export const useStore = create<State>()((set, get) => {
  function recompute(extra: Partial<State> = {}) {
    let d = base
    for (const op of outbox) d = applyOp(d, op)
    const selectedId = get().selectedId
    set({
      tasks: d.tasks,
      lists: d.lists,
      templates: d.templates,
      prefs: d.prefs,
      pending: outbox.length,
      ...(selectedId && !d.tasks[selectedId] ? { selectedId: null } : {}),
      ...extra,
    })
  }

  function persist() {
    saveCache(base, cursor)
  }

  function enqueue(...bodies: OpBody[]) {
    for (const body of bodies) {
      const last = outbox[outbox.length - 1]
      // mehrere Änderungen an derselben Aufgabe zusammenfassen, solange sie noch nicht unterwegs sind
      if (body.kind === 'updateTask' && last && last.kind === 'updateTask' && last.id === body.id && !(flushing && outbox.length === 1)) {
        outbox[outbox.length - 1] = { ...last, patch: { ...last.patch, ...body.patch } }
        continue
      }
      outbox.push(makeOp(body))
    }
    saveOutbox(outbox)
    recompute()
    void flush()
  }

  function scheduleRetry() {
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => void flush(), retryDelay)
    retryDelay = Math.min(60_000, retryDelay * 2)
  }

  async function flush() {
    if (flushing || !get().authed) return
    flushing = true
    clearTimeout(retryTimer)
    let changed = false
    try {
      while (outbox.length) {
        const op = outbox[0]
        try {
          const effect = await sendOp(op)
          base = mergeEffect(base, effect)
          changed = true
          retryDelay = 2000
          if (get().offline) set({ offline: false })
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) return // Sitzung abgelaufen – Warteschlange bleibt
          if (isNetwork(e)) {
            op.tries = (op.tries ?? 0) + 1
            if (e instanceof ApiError && e.status !== 0 && op.tries > 8) {
              get().showToast(`Eine Änderung konnte nicht gespeichert werden: ${msg(e)}`, 'error')
            } else {
              if (e instanceof ApiError && e.status === 0) set({ offline: true })
              saveOutbox(outbox)
              scheduleRetry()
              return
            }
          } else if (e instanceof ApiError && e.status === 409 && (op.kind === 'createTask' || op.kind === 'createList' || (op.kind === 'saveTemplate' && op.create))) {
            // gibt es schon (z. B. Antwort ging verloren) – gilt als erledigt
            changed = true
          } else if (e instanceof ApiError && e.status === 404 && op.kind !== 'restoreTasks') {
            // inzwischen woanders gelöscht – Änderung verwerfen
          } else {
            get().showToast(`Änderung abgelehnt: ${msg(e)}`, 'error')
          }
        }
        outbox.shift()
        saveOutbox(outbox)
        recompute()
      }
    } finally {
      flushing = false
      if (changed) persist()
    }
    // nach dem Abarbeiten einmal nachziehen, was andere Geräte geändert haben
    if (changed) void get().syncChanges()
  }

  function applySync(r: SyncResult) {
    cursor = r.cursor
    const byId = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((x) => [x.id, x])) as Record<string, T>
    if (r.full) {
      base = { tasks: byId(r.tasks), lists: byId(r.lists), templates: byId(r.templates ?? []), prefs: r.prefs ?? {} }
    } else {
      const tasks = { ...base.tasks }
      for (const t of r.tasks) if (newer(tasks[t.id], t)) tasks[t.id] = t
      for (const id of r.deletedTaskIds) delete tasks[id]
      const lists = { ...base.lists }
      for (const l of r.lists) if (newer(lists[l.id], l)) lists[l.id] = l
      for (const id of r.deletedListIds) delete lists[id]
      const templates = { ...base.templates }
      for (const t of r.templates ?? []) if (newer(templates[t.id], t)) templates[t.id] = t
      for (const id of r.deletedTemplateIds ?? []) delete templates[id]
      base = { tasks, lists, templates, prefs: { ...base.prefs, ...(r.prefs ?? {}) } }
    }
    persist()
    recompute({ loaded: true, offline: false })
  }

  function startSession() {
    set({ authed: true })
    void (async () => {
      await flush()
      await get().loadAll()
      void refreshPush()
    })()
    void get().loadGoogle()
    stopLive?.()
    stopLive = connectLive(
      () => void get().syncChanges(),
      (connected) => set({ connected }),
    )
  }

  function endSession(wipe: boolean) {
    stopLive?.()
    stopLive = null
    cursor = 0
    base = emptyData()
    if (wipe) {
      outbox = []
      clearLocal()
    }
    set({ authed: false, lists: {}, tasks: {}, templates: {}, prefs: {}, pending: outbox.length, loaded: false, connected: false, selectedId: null, google: null, events: {} })
  }

  function bootFromCache(): boolean {
    const c = loadCache()
    outbox = loadOutbox()
    if (!c) return false
    base = c.base
    cursor = c.cursor
    recompute({ loaded: true })
    return true
  }

  function handleUrlParams(url = new URL(location.href)) {
    const params = url.searchParams
    let dirty = false
    // Rückkehr von der Google-Anmeldung
    const g = params.get('google')
    if (g) {
      dirty = true
      const text: Record<string, [string, 'info' | 'error']> = {
        connected: ['Google Kalender ist verbunden.', 'info'],
        'not-configured': ['Google ist im Worker noch nicht eingerichtet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).', 'error'],
        login: ['Bitte erst anmelden und dann Google erneut verbinden.', 'error'],
        error: [`Google-Verbindung fehlgeschlagen (${params.get('reason') ?? 'unbekannt'}).`, 'error'],
      }
      const reason = params.get('reason')
      if (g === 'error' && (reason === 'state' || reason === 'expired')) {
        text.error = ['Die Google-Anmeldung war abgelaufen oder wurde doppelt geöffnet – bitte einfach nochmal auf „Mit Google verbinden“.', 'error']
      }
      const [t, k] = text[g] ?? text.error
      setTimeout(() => get().showToast(t, k), 400)
      if (g === 'connected') set({ settingsOpen: true })
    }
    // Verknüpfungen vom Startbildschirm, Benachrichtigungen und „Teilen“
    const view = params.get('view')
    if (view === 'board' || view === 'today' || view === 'calendar') {
      dirty = true
      get().setView(view)
    }
    const action = params.get('action')
    if (action) {
      dirty = true
      if (action === 'new') setTimeout(() => get().openQuickAdd(), 150)
      if (action === 'plan' || action === 'review') setTimeout(() => get().openRitual(action), 300)
      if (action === 'search') setTimeout(() => get().setPalette(true), 150)
    }
    const task = params.get('task')
    if (task) {
      dirty = true
      // warten, bis die Daten da sind (bis zu 15 s)
      let tries = 0
      const tryOpen = () => {
        if (get().tasks[task]) set({ selectedId: task })
        else if (tries++ < 50) setTimeout(tryOpen, 300)
      }
      setTimeout(tryOpen, 200)
    }
    if (url.pathname === '/share' || params.has('share')) {
      dirty = true
      const title = (params.get('title') ?? '').trim()
      const text = (params.get('text') ?? '').trim()
      const link = (params.get('url') ?? '').trim()
      // Viele Apps schicken den Link im Text mit – dann nicht doppelt
      const urlInText = text.match(/https?:\/\/\S+/)?.[0] ?? ''
      const theLink = link || urlInText
      const rest = text.replace(theLink, '').trim()
      const head = title || rest.split('\n')[0] || theLink || 'Geteilt'
      const notes = [rest && rest !== head ? rest : '', theLink].filter(Boolean).join('\n\n') || null
      setTimeout(() => get().openQuickAdd({ notes }, 'Aus „Teilen“ – Titel anpassen und mit Enter sichern', head.slice(0, 200)), 250)
    }
    if (dirty && url.href === location.href) history.replaceState(null, '', '/')
  }

  return {
    authed: null,
    loaded: false,
    lists: {},
    tasks: {},
    templates: {},
    prefs: {},
    connected: false,
    offline: false,
    pending: 0,

    view: load<ViewName>('view', 'board'),
    boardMode: load<BoardMode>('boardMode', 'lists'),
    focusDay: todayStr(),
    selectedId: null,
    quickAdd: { open: false, defaults: {} },
    triageOpen: false,
    settingsOpen: false,
    paletteOpen: false,
    paletteSeq: 0,
    ritual: null,
    templatePicker: null,
    search: '',
    filter: load<TaskFilter>('filter', {}),
    activeViewId: load<string | null>('activeView', null),
    filterOpen: false,
    toast: null,
    expanded: {},
    showSubtasks: load<boolean>('showSubtasks', true),
    showNums: load<boolean>('showNums', true),
    dragging: false,

    google: null,
    events: {},
    eventsLoading: false,

    initAuth: () => {
      if (initialized) return
      initialized = true
      setUnauthorizedHandler(() => get().authed && endSession(false))
      const cached = bootFromCache()
      if (cached) set({ authed: true })
      api
        .me()
        .then(() => startSession())
        .catch((e) => {
          if (e instanceof ApiError && e.status === 0 && cached) {
            set({ offline: true })
            return
          }
          endSession(false)
          if (!(e instanceof ApiError && e.status === 401)) get().showToast(msg(e), 'error')
        })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !get().authed) return
        if (get().focusDay < todayStr()) set({ focusDay: todayStr() })
        if (Date.now() - lastLoad > 30_000) void get().loadAll()
        else void flush()
      })
      window.addEventListener('online', () => {
        retryDelay = 2000
        if (get().authed && !stopLive) api.me().then(() => startSession()).catch(() => undefined)
        else if (get().authed) void flush().then(() => get().loadAll())
        else api.me().then(() => startSession()).catch(() => undefined)
      })
      window.addEventListener('offline', () => set({ offline: true }))
      // Klick auf eine Benachrichtigung, während die App schon offen ist
      navigator.serviceWorker?.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
        if (e.data?.type === 'open' && e.data.url) {
          set({ selectedId: null, ritual: null, paletteOpen: false })
          handleUrlParams(new URL(e.data.url, location.origin))
        }
      })
      handleUrlParams()
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
      endSession(true)
    },

    loadAll: async () => {
      lastLoad = Date.now()
      if (outbox.length) await flush()
      if (outbox.length && get().offline) return
      try {
        const roll = await api.rollover(todayStr())
        applySync(await api.sync(0))
        if (roll.moved > 0) get().showToast(`${roll.moved} unerledigte ${roll.moved === 1 ? 'Aufgabe' : 'Aufgaben'} auf heute übertragen`)
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) set({ offline: true })
        else if (!(e instanceof ApiError && e.status === 401)) get().showToast(`Laden fehlgeschlagen: ${msg(e)}`, 'error')
      }
    },

    syncChanges: async () => {
      if (!get().loaded || !get().authed) return
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
            if (e instanceof ApiError && e.status === 0) set({ offline: true })
            console.warn('sync', e)
          }
        } while (syncAgain)
      })().finally(() => {
        syncing = null
      })
      return syncing
    },

    retryNow: () => {
      retryDelay = 2000
      void flush().then(() => get().syncChanges())
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
    openQuickAdd: (defaults = {}, hint, title) => set({ quickAdd: { open: true, defaults, hint, title }, paletteOpen: false }),
    closeQuickAdd: () => set({ quickAdd: { open: false, defaults: {} } }),
    setTriage: (triageOpen) => set({ triageOpen, paletteOpen: false }),
    setSettings: (settingsOpen) => set({ settingsOpen, paletteOpen: false }),
    setPalette: (paletteOpen) => set((s) => ({ paletteOpen, paletteSeq: paletteOpen && !s.paletteOpen ? s.paletteSeq + 1 : s.paletteSeq })),
    openRitual: (ritual) => set({ ritual, paletteOpen: false, selectedId: null }),
    finishRitual: (kind) => {
      const r = get().prefs.ritual ?? {}
      get().setPref('ritual', { ...r, [kind === 'plan' ? 'planned' : 'reviewed']: todayStr() })
      set({ ritual: null })
    },
    openTemplatePicker: (defaults) => set({ templatePicker: defaults === null ? null : { defaults: defaults ?? {} }, paletteOpen: false }),
    setSearch: (search) => set({ search }),
    setFilter: (filter, viewId = null) => {
      save('filter', filter)
      save('activeView', viewId)
      set({ filter, activeViewId: viewId })
    },
    setFilterOpen: (filterOpen) => set({ filterOpen }),
    applyView: (id) => {
      if (!id) {
        get().setFilter({}, null)
        set({ search: '' })
        return
      }
      const v = (get().prefs.views ?? []).find((x) => x.id === id)
      if (!v) return
      get().setFilter(v.filter, v.id)
      set({ search: v.search ?? '' })
    },
    saveView: (name) => {
      const views = get().prefs.views ?? []
      const v: SavedView = { id: crypto.randomUUID(), name: name.slice(0, 60), filter: get().filter, search: get().search || undefined }
      get().setPref('views', [...views, v])
      get().setFilter(v.filter, v.id)
      get().showToast(`Ansicht „${v.name}“ gespeichert`)
    },
    deleteView: (id) => {
      const views = get().prefs.views ?? []
      get().setPref('views', views.filter((v) => v.id !== id))
      if (get().activeViewId === id) get().setFilter(get().filter, null)
    },
    toggleExpanded: (id) =>
      set((s) => {
        const cur = s.expanded[id] ?? s.showSubtasks
        return { expanded: { ...s.expanded, [id]: !cur } }
      }),
    setShowSubtasks: (showSubtasks) => {
      save('showSubtasks', showSubtasks)
      set({ showSubtasks, expanded: {} })
    },
    setShowNums: (showNums) => {
      save('showNums', showNums)
      set({ showNums })
    },
    setDragging: (dragging) => set({ dragging }),

    showToast: (text, kind = 'info', undo) => {
      const id = ++toastSeq
      set({ toast: { id, msg: text, kind, undo } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, kind === 'error' ? 6500 : undo ? 5500 : 3500)
    },

    createTask: (input) => {
      const body = {
        id: crypto.randomUUID(),
        list_id: null,
        parent_id: null,
        notes: null,
        status: 'open' as const,
        priority: 4 as const,
        horizon: 'backlog' as const,
        tags: [],
        due_date: null,
        start_at: null,
        end_at: null,
        timezone: input.start_at ? deviceTimeZone() : null,
        rrule: null,
        sort: Date.now(),
        origin_event_id: null,
        deadline: null,
        blocked_by: [],
        estimate: null,
        ...input,
      }
      enqueue({ kind: 'createTask', body })
      return get().tasks[body.id]
    },

    updateTask: (id, patch) => {
      const prev = get().tasks[id]
      if (!prev) return
      const fullPatch: TaskPatch = { ...patch }
      if (patch.start_at && !prev.timezone && !patch.timezone) fullPatch.timezone = deviceTimeZone()
      if (patch.rrule && !prev.due_date && !patch.due_date) fullPatch.due_date = todayStr()
      enqueue({ kind: 'updateTask', id, patch: fullPatch })
    },

    toggleDone: (id) => {
      const { tasks } = get()
      const task = tasks[id]
      if (!task) return
      const today = todayStr()
      if (task.status === 'done') {
        enqueue({ kind: 'setStatus', ids: [id], status: 'open', today })
        return
      }
      const desc = descendantIds(tasks, id)
      const ids = [id, ...desc.filter((d) => tasks[d]?.status === 'open')]
      const prev = [task, ...desc.map((d) => tasks[d]).filter(Boolean)]
      enqueue({ kind: 'setStatus', ids, status: 'done', today })

      const after = get().tasks[id]
      const advanced = !!task.rrule && after?.status === 'open'
      const undo = () => {
        if (advanced) {
          const doneKids = prev.filter((x) => x.id !== id && x.status === 'done').map((x) => x.id)
          enqueue({ kind: 'updateTask', id, patch: { due_date: task.due_date, start_at: task.start_at, end_at: task.end_at, timezone: task.timezone } })
          if (doneKids.length) enqueue({ kind: 'setStatus', ids: doneKids, status: 'done', today })
        } else {
          enqueue({ kind: 'setStatus', ids, status: 'open', today })
        }
      }
      const freed = advanced ? [] : newlyFreed(tasks, get().tasks, ids)
      let text = advanced && after?.due_date ? `„${task.title}“ erledigt · nächstes Mal ${shortDate(after.due_date)}` : `„${task.title}“ erledigt`
      if (freed.length === 1) text += ` · „${freed[0].title}“ kann jetzt los`
      else if (freed.length > 1) text += ` · ${freed.length} Aufgaben sind jetzt frei`
      get().showToast(text, 'info', undo)
    },

    deleteTask: (id) => {
      const { tasks } = get()
      const task = tasks[id]
      if (!task) return
      const ids = [id, ...descendantIds(tasks, id)]
      const rows = ids.map((i) => tasks[i]).filter(Boolean)
      enqueue({ kind: 'deleteTask', id })
      get().showToast(`„${task.title}“ gelöscht`, 'info', () => enqueue({ kind: 'restoreTasks', ids, rows }))
    },

    moveToDay: (id, day) => {
      const t = get().tasks[id]
      if (!t) return
      if (day === null) {
        get().updateTask(id, { due_date: null, start_at: null, end_at: null, timezone: null })
        return
      }
      if (t.start_at && t.end_at) {
        const tz = t.timezone ?? deviceTimeZone()
        get().updateTask(id, { ...moveBlockToDate(t.start_at, t.end_at, tz, day), timezone: tz })
        return
      }
      get().updateTask(id, { due_date: day })
    },

    schedule: (id, day, startMin, durationMin) => {
      const start = isoFromDayMinutes(day, startMin)
      const end = isoFromDayMinutes(day, startMin + durationMin)
      get().updateTask(id, { start_at: start, end_at: end, timezone: deviceTimeZone() })
    },

    unschedule: (id) => {
      const t = get().tasks[id]
      if (!t) return
      get().updateTask(id, { start_at: null, end_at: null, timezone: null, due_date: t.due_date })
    },

    setBlockers: (id, blockers) => {
      get().updateTask(id, { blocked_by: [...new Set(blockers)].filter((b) => b !== id) })
    },

    createList: (name, color) => {
      const sort = Math.max(0, ...Object.values(get().lists).map((l) => l.sort)) + 1
      const list = { id: crypto.randomUUID(), name, color, sort }
      enqueue({ kind: 'createList', list })
      return get().lists[list.id]
    },

    updateList: (id, patch) => {
      if (!get().lists[id]) return
      enqueue({ kind: 'updateList', id, patch })
    },

    deleteList: (id) => {
      const name = get().lists[id]?.name
      enqueue({ kind: 'deleteList', id })
      get().showToast(`Liste „${name}“ gelöscht – ihre Aufgaben liegen jetzt in „Unsortiert“`)
    },

    saveAsTemplate: (taskId, name) => {
      const tasks = get().tasks
      const root = tasks[taskId]
      if (!root) return
      const toNode = (t: Task, depth: number): TemplateNode => {
        const kids = depth < 3 ? childrenOf(tasks, t.id).sort(compareTasks) : []
        return {
          title: t.title,
          notes: t.notes,
          priority: t.priority,
          tags: t.tags,
          rrule: t.rrule,
          ...(kids.length ? { subtasks: kids.map((k) => toNode(k, depth + 1)) } : {}),
        }
      }
      enqueue({ kind: 'saveTemplate', id: crypto.randomUUID(), create: true, name: name.trim().slice(0, 100) || root.title, payload: toNode(root, 0) })
      get().showToast(`Vorlage „${name || root.title}“ gespeichert`)
    },

    renameTemplate: (id, name) => {
      const n = name.trim().slice(0, 100)
      if (n) enqueue({ kind: 'saveTemplate', id, create: false, name: n })
    },

    deleteTemplate: (id) => {
      const tpl = get().templates[id]
      if (!tpl) return
      enqueue({ kind: 'deleteTemplate', id })
      get().showToast(`Vorlage „${tpl.name}“ gelöscht`, 'info', () =>
        enqueue({ kind: 'saveTemplate', id: crypto.randomUUID(), create: true, name: tpl.name, payload: tpl.payload }),
      )
    },

    useTemplate: (id, defaults = {}) => {
      const tpl = get().templates[id]
      if (!tpl) return null
      const bodies: OpBody[] = []
      let sort = Date.now()
      const build = (node: TemplateNode, parent: string | null): string => {
        const tid = crypto.randomUUID()
        const isRoot = parent === null
        bodies.push({
          kind: 'createTask',
          body: {
            id: tid,
            title: node.title,
            notes: node.notes ?? null,
            priority: (node.priority ?? 4) as Task['priority'],
            tags: node.tags ?? [],
            rrule: isRoot ? (node.rrule ?? null) : null,
            parent_id: parent,
            list_id: defaults.list_id ?? null,
            horizon: defaults.horizon ?? 'backlog',
            status: 'open',
            due_date: isRoot ? (defaults.due_date ?? (node.rrule ? todayStr() : null)) : null,
            start_at: isRoot ? (defaults.start_at ?? null) : null,
            end_at: isRoot ? (defaults.end_at ?? null) : null,
            timezone: isRoot && defaults.start_at ? deviceTimeZone() : null,
            deadline: isRoot ? (defaults.deadline ?? null) : null,
            blocked_by: [],
            origin_event_id: null,
            sort: isRoot ? (defaults.sort ?? sort++) : sort++,
          },
        })
        for (const k of node.subtasks ?? []) build(k, tid)
        return tid
      }
      const rootId = build(tpl.payload, defaults.parent_id ?? null)
      enqueue(...bodies)
      get().showToast(`„${tpl.payload.title}“ aus Vorlage angelegt`, 'info', () => enqueue({ kind: 'deleteTask', id: rootId }))
      set({ templatePicker: null })
      return get().tasks[rootId] ?? null
    },

    setPref: (key, value) => enqueue({ kind: 'setPref', key, value }),

    loadGoogle: async () => {
      try {
        set({ google: await api.googleStatus() })
      } catch (e) {
        console.warn('google status', e)
        if (!(e instanceof ApiError && e.status === 0)) set({ google: { configured: false, connected: false } })
      }
    },

    refreshGoogle: async () => {
      try {
        await api.googleRefresh()
        eventRequests.clear()
        set({ events: {} })
        await get().loadGoogle()
        void get().syncChanges()
        get().showToast('Google Kalender abgeglichen')
      } catch (e) {
        get().showToast(msg(e), 'error')
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

    setGoogleTasks: async (enabled) => {
      try {
        set({ google: await api.googleTasks(enabled) })
        get().showToast(enabled ? 'Aufgaben mit Tag erscheinen jetzt in Google unter „Aufgaben“' : 'Google Aufgaben ausgeschaltet – die Liste „Organizer“ wurde in Google entfernt')
        return true
      } catch (e) {
        get().showToast(msg(e), 'error')
        void get().loadGoogle()
        return false
      }
    },

    importEvent: (ev) => {
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
      const t = get().createTask(patch)
      get().showToast(`„${t.title}“ als Aufgabe übernommen`)
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
