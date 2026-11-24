import { DurableObject } from 'cloudflare:workers'
import { MIGRATIONS, upgradePrio } from './migrations'
import { login, logout, requireSession } from './auth'
import { HttpError, cleanListInput, cleanTaskInput, dateInZone, isDate, isUuid, listOut, normalizeTask, taskOut, type ListRow, type TaskRow } from './db'
import {
  EVENT_COLORS,
  GoogleApiError,
  ORGANIZER_CALENDAR_MARK,
  ORGANIZER_CALENDAR_NAME,
  buildAuthUrl,
  exchangeCode,
  gapi,
  googleConfig,
  pkcePair,
  randomState,
  refreshAccessToken,
  revokeToken,
  SCOPES,
  TASKS_SCOPE,
  EVENTS_SCOPE,
  type ApiOpts,
  type GTask,
  type GTaskList,
  type GCalendarListEntry,
  type GEvent,
  type GEventTime,
  type GEventList,
  type GoogleConfig,
  type GoogleEnv,
} from './google'
import { daysBetween, nextOccurrence } from '../shared/recurrence'
import { moveBlockToDate, utcToZoned, zonedToUtc } from '../shared/tz'
import { generateVapidKeys, sendTickle, validEndpoint, type VapidKeys } from './push'

export interface Env extends GoogleEnv {
  STORE: DurableObjectNamespace<OrganizerStore>
  ASSETS: Fetcher
  APP_PASSWORD?: string
}

interface GoogleAccountRow extends Record<string, SqlStorageValue> {
  id: number
  email: string | null
  refresh_token: string
  access_token: string | null
  access_expires_at: number | null
  organizer_calendar_id: string | null
  selected_calendars: string | null
  sync_token: string | null
  status: string
  connected_at: string
  scopes: string | null
  tasks_list_id: string | null
  tasks_enabled: number | null
  tasks_cursor: string | null
  tasks_problem: string | null
}

/** Erinnerung vor einer Frist mit Uhrzeit */
const DEADLINE_LEAD = 60 * 60_000

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } })

const nowIso = () => new Date().toISOString()
const utcToday = () => new Date().toISOString().slice(0, 10)
const MIN = 60_000
const DAY = 86_400_000
const PULL_EVERY = 10 * MIN

const TASK_PATH = /^\/api\/tasks\/([0-9a-f-]{36})$/i
const LIST_PATH = /^\/api\/lists\/([0-9a-f-]{36})$/i
const TEMPLATE_PATH = /^\/api\/templates\/([0-9a-f-]{36})$/i
const PREF_PATH = /^\/api\/prefs\/(views|push|ritual|board|day|calendar)$/

/** Nach jeder Änderung: muss der Google-Termin der Aufgabe angepasst werden? */
// Achtung: in SQLite sehen Ausdrücke in SET die ALTEN Spaltenwerte. Gut für Statusänderungen/Löschen,
// wo Datum und Uhrzeit gleich bleiben; writeTask rechnet mit den neuen Werten selbst.
const MARK_DIRTY = `gcal_dirty = CASE WHEN start_at IS NOT NULL OR gcal_event_id IS NOT NULL THEN 1 ELSE gcal_dirty END,
  gtask_dirty = CASE WHEN gtask_id IS NOT NULL OR (due_date IS NOT NULL AND start_at IS NULL) THEN 1 ELSE gtask_dirty END`
const LANE = 'Organizer'

async function readJson(req: Request): Promise<unknown> {
  if (!(req.headers.get('Content-Type') ?? '').includes('application/json')) throw new HttpError(415, 'JSON erwartet')
  try {
    return await req.json()
  } catch {
    throw new HttpError(400, 'Ungültiges JSON')
  }
}

function idList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500 || !v.every(isUuid)) throw new HttpError(400, 'Ungültige id-Liste')
  return v
}

function constraintError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (msg.includes('UNIQUE constraint')) throw new HttpError(409, 'Existiert bereits')
  if (msg.includes('FOREIGN KEY constraint')) throw new HttpError(400, 'Verweis auf nicht vorhandene Liste oder Aufgabe')
  if (msg.includes('CHECK constraint')) throw new HttpError(400, 'Ungültige Werte')
  throw e
}

export interface CalendarEventOut {
  id: string
  calendarId: string
  calendarName: string
  title: string
  start: string
  end: string
  allDay: boolean
  color: string
  location: string | null
  link: string | null
  description: string | null
  /** darf geändert werden (eigener Kalender bzw. Schreibrecht) */
  writable: boolean
  colorId: string | null
  /** Serie: id des Ursprungstermins */
  recurringId: string | null
  meet: string | null
  /** Anzahl Gäste (ohne mich) */
  guests: number
}

/**
 * Die ganze Datenhaltung der App in einem einzigen Durable Object:
 * SQLite-Datenbank, Anmeldung, Live-Sync per WebSocket und die Anbindung an Google Kalender.
 */
export class OrganizerStore extends DurableObject<Env> {
  private sql: SqlStorage
  private pushing: Promise<void> | null = null
  private pulling: Promise<boolean> | null = null
  private lastPull = 0
  private eventCache = new Map<string, { at: number; data: CalendarEventOut[] }>()
  private calendarCache: { at: number; data: GCalendarListEntry[] } | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    ctx.blockConcurrencyWhile(async () => {
      this.migrate()
      if (this.metaGet('cleanup_at') === null) this.metaSet('cleanup_at', Date.now() + DAY)
      await this.scheduleAlarm()
    })
  }

  // -------------------------------------------------------------------------
  // Schema & Meta
  // -------------------------------------------------------------------------
  private migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
    const applied = new Set(this.sql.exec<{ id: number }>(`SELECT id FROM _migrations`).toArray().map((r) => r.id))
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue
      this.ctx.storage.transactionSync(() => {
        for (const s of m.statements) this.sql.exec(s)
        m.run?.(this.sql)
        this.sql.exec(`INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)`, m.id, m.name, nowIso())
      })
      console.log(`Migration ${m.id} (${m.name}) eingespielt`)
    }
  }

  private metaGet(key: string): number | null {
    const r = this.sql.exec<{ value: number }>(`SELECT value FROM meta WHERE key = ?`, key).toArray()[0]
    return r ? r.value : null
  }

  private metaSet(key: string, value: number | null) {
    if (value === null) this.sql.exec(`DELETE FROM meta WHERE key = ?`, key)
    else this.sql.exec(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
  }

  /** Fortlaufende Änderungsnummer für die Synchronisation */
  /** Laufende Nummer für neue Aufgaben (wird nie wiederverwendet) */
  private nextNum(): number {
    return this.sql.exec<{ n: number }>(`UPDATE meta SET value = value + 1 WHERE key = 'next_num' RETURNING value - 1 AS n`).one().n
  }

  private nextSeq(): number {
    return this.sql.exec<{ value: number }>(`UPDATE meta SET value = value + 1 WHERE key = 'seq' RETURNING value`).one().value
  }

  private tx<T>(fn: () => T): T {
    try {
      return this.ctx.storage.transactionSync(fn)
    } catch (e) {
      if (e instanceof HttpError) throw e
      constraintError(e)
    }
  }

  // -------------------------------------------------------------------------
  // Alarm: Aufräumen, Google abgleichen, fehlgeschlagene Übertragungen wiederholen
  // -------------------------------------------------------------------------
  private async scheduleAlarm() {
    const times = ['cleanup_at', 'gpull_at', 'gpush_at', 'push_at'].map((k) => this.metaGet(k)).filter((v): v is number => v !== null)
    if (!times.length) return
    const next = Math.max(Date.now() + 1000, Math.min(...times))
    const cur = await this.ctx.storage.getAlarm()
    if (cur === null || Math.abs(cur - next) > 1000) await this.ctx.storage.setAlarm(next)
  }

  async alarm() {
    const now = Date.now()
    if ((this.metaGet('cleanup_at') ?? 0) <= now) {
      this.cleanup()
      this.metaSet('cleanup_at', now + DAY)
    }
    if ((this.metaGet('gpush_at') ?? Infinity) <= now) {
      this.metaSet('gpush_at', null)
      await this.pushGoogle()
    }
    if ((this.metaGet('push_at') ?? Infinity) <= now + 30_000) {
      await this.sendDueReminders().catch((e) => console.warn('reminders', e))
      this.planReminders()
    }
    if ((this.metaGet('gpull_at') ?? Infinity) <= now) {
      this.metaSet('gpull_at', this.account() ? now + PULL_EVERY : null)
      const changed = await this.pullGoogle().catch((e) => {
        console.warn('pull', e)
        return false
      })
      if (changed) this.broadcast()
    }
    await this.scheduleAlarm()
  }

  private cleanup() {
    const now = Date.now()
    const cutoff = new Date(now - 30 * DAY).toISOString()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM sessions WHERE expires_at < ?`, new Date(now).toISOString())
      this.sql.exec(`DELETE FROM login_attempts WHERE ts < ?`, now - DAY)
      this.sql.exec(`DELETE FROM oauth_states WHERE created_at < ?`, now - DAY)
      this.sql.exec(`DELETE FROM op_log WHERE created_at < ?`, now - 7 * DAY)
      this.sql.exec(`UPDATE tasks SET parent_id = NULL WHERE (deleted_at IS NULL OR deleted_at >= ?1) AND parent_id IN (SELECT id FROM tasks WHERE deleted_at < ?1)`, cutoff)
      this.sql.exec(`UPDATE tasks SET list_id = NULL WHERE list_id IN (SELECT id FROM lists WHERE deleted_at < ?)`, cutoff)
      this.sql.exec(`DELETE FROM tasks WHERE deleted_at < ? AND gcal_dirty = 0 AND gtask_dirty = 0`, cutoff)
      this.sql.exec(`DELETE FROM lists WHERE deleted_at < ?`, cutoff)
    })
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------
  async fetch(req: Request): Promise<Response> {
    try {
      return await this.route(req)
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status)
      if (e instanceof GoogleApiError) return json({ error: `Google: ${e.message}` }, 502)
      console.error(e)
      return json({ error: 'Interner Fehler' }, 500)
    }
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url
    const method = req.method

    if (pathname === '/api/login' && method === 'POST') return login(req, this.sql, this.env.APP_PASSWORD)

    if (pathname === '/api/google/callback' && method === 'GET') {
      try {
        await requireSession(req, this.sql)
      } catch {
        return redirect('/?google=login')
      }
      return this.googleCallback(url)
    }

    await requireSession(req, this.sql)

    if (pathname === '/api/live') {
      if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'WebSocket erwartet')
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }
    if (pathname === '/api/logout' && method === 'POST') return logout(req, this.sql)
    if (pathname === '/api/me' && method === 'GET') return json({ ok: true })
    if (pathname === '/api/sync' && method === 'GET') {
      const out = this.sync(url)
      // beim App-Start auch Änderungen aus Google holen (im Hintergrund)
      if (out.full && Date.now() - this.lastPull > MIN && this.account()) this.ctx.waitUntil(this.pullAndBroadcast())
      return json(out)
    }

    // Push
    if (pathname === '/api/push/key' && method === 'GET') return json({ publicKey: (await this.vapid()).publicKey })
    if (pathname === '/api/push/subscribe' && method === 'POST') return json(await this.pushSubscribe(req, await readJson(req)))
    if (pathname === '/api/push/unsubscribe' && method === 'POST') return json(this.pushUnsubscribe(await readJson(req)))
    if (pathname === '/api/push/pending' && method === 'GET') return json(this.pushPending())
    if (pathname === '/api/push/test' && method === 'POST') return json(await this.pushTest())

    // Google
    if (pathname === '/api/google/status' && method === 'GET') return json(await this.googleStatus())
    if (pathname === '/api/google/connect' && method === 'GET') return this.googleConnect(url)
    if (pathname === '/api/google/events' && method === 'GET') return json(await this.googleEvents(url))
    if (pathname === '/api/google/events' && method === 'POST') return json(await this.createEvent(await readJson(req)), 201)
    if (pathname === '/api/google/events' && method === 'PATCH') return json(await this.updateEvent(await readJson(req)))
    if (pathname === '/api/google/events/delete' && method === 'POST') {
      const r = await this.deleteEvent(await readJson(req))
      this.planReminders()
      return json(r)
    }
    if (pathname === '/api/google/search' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      if (q.length < 2 || q.length > 100) throw new HttpError(400, 'Suchbegriff zu kurz')
      return json(await this.searchEvents(q))
    }
    if (pathname === '/api/google/disconnect' && method === 'POST') return json(await this.googleDisconnect())
    if (pathname === '/api/google/calendars' && method === 'POST') return json(this.googleSetCalendars(await readJson(req)))
    if (pathname === '/api/google/tasks' && method === 'POST') {
      const out = await this.googleTasksToggle(await readJson(req))
      this.broadcast()
      return json(out)
    }
    if (pathname === '/api/google/refresh' && method === 'POST') {
      this.eventCache.clear()
      this.calendarCache = null
      const changed = await this.pullGoogle()
      if (changed) this.broadcast()
      return json({ ok: true })
    }

    // ab hier nur Änderungen an Aufgaben/Listen
    const tm = pathname.match(TASK_PATH)
    const lm = pathname.match(LIST_PATH)
    const tplm = pathname.match(TEMPLATE_PATH)
    const prefm = pathname.match(PREF_PATH)
    // Offline-Warteschlange: jede Änderung hat eine eigene id. Kommt dieselbe nochmal
    // (Antwort ging unterwegs verloren), liefern wir die alte Antwort statt sie doppelt auszuführen.
    const opId = req.headers.get('X-Op-Id')
    if (opId && isUuid(opId)) {
      const seen = this.sql.exec<{ status: number; body: string }>(`SELECT status, body FROM op_log WHERE op_id = ?`, opId).toArray()[0]
      if (seen) return new Response(seen.body, { status: seen.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
    }

    // Ältere App-Versionen (noch im Zwischenspeicher eines Geräts) schicken Wichtigkeit 1–4 (1 = hoch) → umrechnen
    const legacy = req.headers.get('X-Scale') !== '2'
    const body = async () => {
      const b = await readJson(req)
      return legacy ? legacyBody(b) : b
    }

    let out: [unknown, number] | null = null
    if (pathname === '/api/rollover' && method === 'POST') out = [this.rollover(await readJson(req)), 200]
    else if (pathname === '/api/tasks' && method === 'POST') out = [this.createTask(await body()), 201]
    else if (pathname === '/api/tasks/bulk' && method === 'POST') out = [this.bulkStatus(await readJson(req)), 200]
    else if (pathname === '/api/tasks/restore' && method === 'POST') out = [this.restoreTasks(await readJson(req)), 200]
    else if (tm && method === 'PATCH') out = [this.updateTask(tm[1], await body()), 200]
    else if (tm && method === 'DELETE') out = [this.deleteTask(tm[1]), 200]
    else if (pathname === '/api/lists' && method === 'POST') out = [this.createList(await readJson(req)), 201]
    else if (lm && method === 'PATCH') out = [this.updateList(lm[1], await readJson(req)), 200]
    else if (lm && method === 'DELETE') out = [this.deleteList(lm[1]), 200]
    else if (pathname === '/api/templates' && method === 'POST') out = [this.saveTemplate(null, await body()), 201]
    else if (tplm && method === 'PATCH') out = [this.saveTemplate(tplm[1], await body()), 200]
    else if (tplm && method === 'DELETE') out = [this.deleteTemplate(tplm[1]), 200]
    else if (prefm && method === 'PUT') out = [this.setPref(prefm[1], await readJson(req)), 200]

    if (!out) throw new HttpError(404, 'Unbekannte Adresse')
    const res = json(out[0], out[1])
    if (opId && isUuid(opId)) {
      this.sql.exec(`INSERT OR REPLACE INTO op_log (op_id, status, body, created_at) VALUES (?, ?, ?, ?)`, opId, out[1], JSON.stringify(out[0]), Date.now())
    }
    this.broadcast()
    this.queuePush()
    this.planReminders()
    await this.scheduleAlarm()
    return res
  }

  // -------------------------------------------------------------------------
  // Live-Sync
  // -------------------------------------------------------------------------
  private broadcast() {
    const msg = JSON.stringify({ type: 'changed', at: Date.now() })
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg)
      } catch {
        /* Verbindung schon weg */
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === 'ping') ws.send('pong')
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason)
    } catch {
      /* schon zu */
    }
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, 'Fehler')
    } catch {
      /* schon zu */
    }
  }

  // -------------------------------------------------------------------------
  // Aufgaben & Listen
  // -------------------------------------------------------------------------
  private sync(url: URL) {
    const since = Number(url.searchParams.get('since') ?? '0')
    if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'Ungültiger Stand')
    const cursor = this.metaGet('seq') ?? 0
    let lists: ListRow[]
    let tasks: TaskRow[]
    if (since === 0) {
      const doneSince = new Date(Date.now() - 14 * DAY).toISOString()
      lists = this.sql.exec<ListRow>(`SELECT * FROM lists WHERE deleted_at IS NULL ORDER BY sort`).toArray()
      tasks = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE deleted_at IS NULL AND (status = 'open' OR completed_at >= ?)`, doneSince).toArray()
    } else {
      lists = this.sql.exec<ListRow>(`SELECT * FROM lists WHERE seq > ?`, since).toArray()
      tasks = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE seq > ?`, since).toArray()
    }
    return {
      cursor,
      full: since === 0,
      lists: lists.filter((l) => !l.deleted_at).map(listOut),
      tasks: tasks.filter((t) => !t.deleted_at).map(taskOut),
      deletedListIds: lists.filter((l) => l.deleted_at).map((l) => l.id),
      deletedTaskIds: tasks.filter((t) => t.deleted_at).map((t) => t.id),
      ...this.syncExtras(since),
    }
  }

  private syncExtras(since: number) {
    const tpl = this.sql.exec<TemplateRow>(since ? `SELECT * FROM templates WHERE seq > ?` : `SELECT * FROM templates WHERE deleted_at IS NULL`, ...(since ? [since] : [])).toArray()
    const prefs = this.sql.exec<{ key: string; value: string }>(since ? `SELECT key, value FROM prefs WHERE seq > ?` : `SELECT key, value FROM prefs`, ...(since ? [since] : [])).toArray()
    return {
      templates: tpl.filter((t) => !t.deleted_at).map(templateOut),
      deletedTemplateIds: tpl.filter((t) => t.deleted_at).map((t) => t.id),
      prefs: Object.fromEntries(prefs.map((p) => [p.key, safeJson(p.value)])),
    }
  }

  private checkRefs(selfId: string, listId: string | null | undefined, parentId: string | null | undefined) {
    if (listId && !this.sql.exec(`SELECT 1 FROM lists WHERE id = ? AND deleted_at IS NULL`, listId).toArray().length) {
      throw new HttpError(400, 'Liste existiert nicht')
    }
    if (parentId) {
      if (parentId === selfId) throw new HttpError(400, 'Aufgabe kann nicht ihre eigene Unteraufgabe sein')
      if (!this.sql.exec(`SELECT 1 FROM tasks WHERE id = ? AND deleted_at IS NULL`, parentId).toArray().length) {
        throw new HttpError(400, 'Elternaufgabe existiert nicht')
      }
      const cycle = this.sql
        .exec(
          `WITH RECURSIVE anc(id, parent_id) AS (
             SELECT id, parent_id FROM tasks WHERE id = ?1
             UNION SELECT t.id, t.parent_id FROM tasks t JOIN anc ON t.id = anc.parent_id
           ) SELECT 1 FROM anc WHERE id = ?2 LIMIT 1`,
          parentId,
          selfId,
        )
        .toArray()
      if (cycle.length) throw new HttpError(400, 'Das würde einen Kreis in den Unteraufgaben erzeugen')
    }
  }

  private writeTask(id: string, t: TaskFields, now: string, insert: boolean, extra: { gcal_event_id?: string | null; gcal_etag?: string | null; dirty?: boolean } = {}): TaskRow {
    const seq = this.nextSeq()
    const values = [
      t.list_id,
      t.parent_id,
      t.title,
      t.notes,
      t.status,
      t.priority,
      t.horizon,
      JSON.stringify(t.tags),
      t.due_date,
      t.start_at,
      t.end_at,
      t.timezone,
      t.rrule,
      t.completed_at,
      t.sort,
      t.origin_event_id,
      t.deadline,
      JSON.stringify(t.blocked_by ?? []),
      t.estimate ?? null,
      t.day_order ?? null,
      t.part_index ?? null,
    ]
    if (insert) {
      return this.sql
        .exec<TaskRow>(
          `INSERT INTO tasks (list_id, parent_id, title, notes, status, prio, horizon, tags, due_date, start_at, end_at,
             timezone, rrule, completed_at, sort, origin_event_id, deadline, blocked_by, estimate, day_order, part_index, num, id, created_at, updated_at, seq, gcal_event_id, gcal_etag, gcal_dirty, gtask_dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          ...values,
          this.nextNum(),
          id,
          now,
          now,
          seq,
          extra.gcal_event_id ?? null,
          extra.gcal_etag ?? null,
          extra.dirty === false ? 0 : t.start_at ? 1 : 0,
          extra.dirty === false ? 0 : !t.start_at && t.due_date && t.status === 'open' ? 1 : 0,
        )
        .one()
    }
    const wantsEvent = t.start_at ? 1 : 0
    const wantsTask = !t.start_at && t.due_date ? 1 : 0
    return this.sql
      .exec<TaskRow>(
        `UPDATE tasks SET list_id = ?, parent_id = ?, title = ?, notes = ?, status = ?, prio = ?, horizon = ?, tags = ?,
           due_date = ?, start_at = ?, end_at = ?, timezone = ?, rrule = ?, completed_at = ?, sort = ?, origin_event_id = ?,
           deadline = ?, blocked_by = ?, estimate = ?, day_order = ?, part_index = ?,
           updated_at = ?, seq = ?,
           gcal_dirty = CASE WHEN ? = 1 AND (? = 1 OR gcal_event_id IS NOT NULL) THEN 1 ELSE gcal_dirty END,
           gtask_dirty = CASE WHEN ? = 1 AND (? = 1 OR gtask_id IS NOT NULL) THEN 1 ELSE gtask_dirty END
         WHERE id = ? RETURNING *`,
        ...values,
        now,
        seq,
        extra.dirty === false ? 0 : 1,
        wantsEvent,
        extra.dirty === false ? 0 : 1,
        wantsTask,
        id,
      )
      .one()
  }

  /** „Wartet auf“: keine Selbstblockade, keine Kreise (A wartet auf B wartet auf A) */
  private checkBlockers(id: string, blockers: string[]) {
    if (!blockers.length) return
    if (blockers.includes(id)) throw new HttpError(400, 'Eine Aufgabe kann nicht auf sich selbst warten')
    const graph = new Map<string, string[]>()
    for (const r of this.sql.exec<{ id: string; blocked_by: string }>(`SELECT id, blocked_by FROM tasks WHERE deleted_at IS NULL AND blocked_by != '[]'`).toArray()) {
      try {
        graph.set(r.id, JSON.parse(r.blocked_by))
      } catch {
        /* egal */
      }
    }
    graph.set(id, blockers)
    const seen = new Set<string>()
    const stack = [...blockers]
    while (stack.length) {
      const cur = stack.pop()!
      if (cur === id) throw new HttpError(400, 'Das würde eine Kreis-Abhängigkeit erzeugen')
      if (seen.has(cur)) continue
      seen.add(cur)
      stack.push(...(graph.get(cur) ?? []))
    }
  }

  private createTask(body: unknown) {
    const input = cleanTaskInput(body)
    if (!input.title) throw new HttpError(400, 'Titel fehlt')
    const id = input.id ?? crypto.randomUUID()
    const now = nowIso()
    const t = normalizeTask({ ...DEFAULT_TASK(), sort: Date.now(), ...input, title: input.title }, now)
    return this.tx(() => {
      this.checkRefs(id, t.list_id, t.parent_id)
      this.checkBlockers(id, t.blocked_by)
      const row = this.writeTask(id, t, now, true)
      // neuer Teil → die anderen Teile in Google neu beschriften („Teil 1/2“ → „Teil 1/3“)
      if (t.part_index !== null && t.parent_id) {
        this.sql.exec(
          `UPDATE tasks SET gcal_dirty = CASE WHEN gcal_event_id IS NOT NULL THEN 1 ELSE gcal_dirty END,
             gtask_dirty = CASE WHEN gtask_id IS NOT NULL THEN 1 ELSE gtask_dirty END
           WHERE parent_id = ? AND part_index IS NOT NULL AND id != ? AND deleted_at IS NULL`,
          t.parent_id,
          id,
        )
      }
      return taskOut(row)
    })
  }

  private updateTask(id: string, body: unknown) {
    const patch = cleanTaskInput(body)
    delete patch.id
    return this.tx(() => {
      const cur = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`, id).toArray()[0]
      if (!cur) throw new HttpError(404, 'Aufgabe nicht gefunden')
      if ('list_id' in patch || 'parent_id' in patch) this.checkRefs(id, patch.list_id, patch.parent_id)
      if (patch.blocked_by) this.checkBlockers(id, patch.blocked_by)
      const now = nowIso()
      const t = normalizeTask({ ...taskOut(cur), ...patch }, now)
      return taskOut(this.writeTask(id, t, now, false))
    })
  }

  /**
   * Erledigen / wieder öffnen. Wiederkehrende Aufgaben werden beim Erledigen nicht abgeschlossen,
   * sondern rücken auf den nächsten Termin vor (Unteraufgaben werden dabei wieder geöffnet).
   */
  private bulkStatus(body: unknown) {
    const b = (body ?? {}) as { ids?: unknown; status?: unknown; today?: unknown }
    const ids = idList(b.ids)
    if (b.status !== 'open' && b.status !== 'done') throw new HttpError(400, 'Ungültiger Status')
    const status = b.status
    const today = isDate(b.today) ? b.today : utcToday()
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      const changed: TaskRow[] = []
      const advanced: { id: string; next: string }[] = []
      let doneIds = ids

      if (status === 'done') {
        const rows = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`, JSON.stringify(ids)).toArray()
        const recurring = rows.filter((r) => r.rrule && r.status === 'open')
        const reopen = new Set<string>()
        for (const r of recurring) {
          const from = r.due_date ?? today
          const next = nextOccurrence(r.rrule!, from, today)
          if (!next) continue
          let start = r.start_at
          let end = r.end_at
          if (r.start_at && r.end_at && r.timezone) ({ start_at: start, end_at: end } = moveBlockToDate(r.start_at, r.end_at, r.timezone, next))
          const due = start && r.timezone ? dateInZone(start, r.timezone) : next
          changed.push(
            this.sql
              .exec<TaskRow>(
                `UPDATE tasks SET due_date = ?, start_at = ?, end_at = ?, rollover_count = 0, status = 'open', completed_at = NULL, day_order = NULL,
                   updated_at = ?, seq = ?, ${MARK_DIRTY} WHERE id = ? RETURNING *`,
                due,
                start,
                end,
                now,
                seq,
                r.id,
              )
              .one(),
          )
          advanced.push({ id: r.id, next: due })
          // Unteraufgaben (alle Ebenen) wieder öffnen
          for (const d of this.sql
            .exec<{ id: string }>(
              `WITH RECURSIVE sub(id) AS (SELECT id FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL
                 UNION SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL) SELECT id FROM sub`,
              r.id,
            )
            .toArray())
            reopen.add(d.id)
        }
        const skip = new Set([...recurring.map((r) => r.id), ...reopen])
        doneIds = ids.filter((i) => !skip.has(i))
        if (reopen.size) {
          changed.push(
            ...this.sql
              .exec<TaskRow>(
                `UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = ?, seq = ?, ${MARK_DIRTY}
                 WHERE id IN (SELECT value FROM json_each(?)) RETURNING *`,
                now,
                seq,
                JSON.stringify([...reopen]),
              )
              .toArray(),
          )
        }
      }

      if (doneIds.length) {
        changed.push(
          ...this.sql
            .exec<TaskRow>(
              `UPDATE tasks SET status = ?1,
                 completed_at = CASE WHEN ?1 = 'done' THEN COALESCE(completed_at, ?2) ELSE NULL END,
                 updated_at = ?2, seq = ?3, ${MARK_DIRTY}
               WHERE id IN (SELECT value FROM json_each(?4)) AND deleted_at IS NULL RETURNING *`,
              status,
              now,
              seq,
              JSON.stringify(doneIds),
            )
            .toArray(),
        )
      }
      // Teile: alle erledigt → Hauptaufgabe erledigt; ein Teil wieder offen → Hauptaufgabe wieder offen
      const parents = [...new Set(changed.filter((r) => r.part_index !== null && r.parent_id).map((r) => r.parent_id!))]
      for (const pid of parents) {
        const parent = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`, pid).toArray()[0]
        if (!parent || parent.rrule) continue
        const open = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND deleted_at IS NULL AND status = 'open'`, pid).one().n
        const want = open === 0 ? 'done' : 'open'
        if (parent.status === want || (want === 'open' && status === 'done')) continue
        changed.push(
          this.sql
            .exec<TaskRow>(
              `UPDATE tasks SET status = ?1, completed_at = CASE WHEN ?1 = 'done' THEN COALESCE(completed_at, ?2) ELSE NULL END,
                 updated_at = ?2, seq = ?3, ${MARK_DIRTY} WHERE id = ?4 RETURNING *`,
              want,
              now,
              seq,
              pid,
            )
            .one(),
        )
      }
      return { tasks: changed.map(taskOut), advanced }
    })
  }

  private deleteTask(id: string) {
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      const ids = this.sql
        .exec<{ id: string }>(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM tasks WHERE id = ?1 AND deleted_at IS NULL
             UNION SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL
           )
           UPDATE tasks SET deleted_at = ?2, updated_at = ?2, seq = ?3, ${MARK_DIRTY} WHERE id IN (SELECT id FROM sub) RETURNING id`,
          id,
          now,
          seq,
        )
        .toArray()
        .map((r) => r.id)
      if (!ids.length) throw new HttpError(404, 'Aufgabe nicht gefunden')
      return { ids }
    })
  }

  private restoreTasks(body: unknown) {
    const ids = idList((body as { ids?: unknown } | null)?.ids)
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      const rows = this.sql
        .exec<TaskRow>(
          `UPDATE tasks SET deleted_at = NULL, updated_at = ?1, seq = ?2, ${MARK_DIRTY},
             list_id = CASE WHEN list_id IN (SELECT id FROM lists WHERE deleted_at IS NULL) THEN list_id ELSE NULL END
           WHERE id IN (SELECT value FROM json_each(?3)) AND deleted_at IS NOT NULL RETURNING *`,
          now,
          seq,
          JSON.stringify(ids),
        )
        .toArray()
      return { tasks: rows.map(taskOut) }
    })
  }

  private rollover(body: unknown) {
    const today = (body as { today?: unknown } | null)?.today
    if (!isDate(today)) throw new HttpError(400, 'Ungültiges Datum')
    return this.tx(() => {
      const due = this.sql.exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND start_at IS NULL AND due_date < ?`,
        today,
      ).one().n
      if (!due) return { moved: 0 }
      const seq = this.nextSeq()
      const moved = this.sql
        .exec(
          `UPDATE tasks SET
             rollover_count = rollover_count + CAST(julianday(?1) - julianday(due_date) AS INTEGER),
             due_date = ?1, day_order = NULL, updated_at = ?2, seq = ?3, gtask_dirty = 1
           WHERE deleted_at IS NULL AND status = 'open' AND start_at IS NULL AND due_date < ?1
           RETURNING id`,
          today,
          nowIso(),
          seq,
        )
        .toArray().length
      return { moved }
    })
  }

  private createList(body: unknown) {
    const input = cleanListInput(body)
    if (!input.name) throw new HttpError(400, 'Name fehlt')
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      const row = this.sql
        .exec<ListRow>(
          `INSERT INTO lists (id, name, color, sort, archived, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          input.id ?? crypto.randomUUID(),
          input.name,
          input.color ?? '#2f5d50',
          input.sort ?? Date.now(),
          input.archived ? 1 : 0,
          now,
          now,
          seq,
        )
        .one()
      return listOut(row)
    })
  }

  private updateList(id: string, body: unknown) {
    const patch = cleanListInput(body)
    return this.tx(() => {
      const cur = this.sql.exec<ListRow>(`SELECT * FROM lists WHERE id = ? AND deleted_at IS NULL`, id).toArray()[0]
      if (!cur) throw new HttpError(404, 'Liste nicht gefunden')
      const l = { ...listOut(cur), ...patch }
      const seq = this.nextSeq()
      const row = this.sql
        .exec<ListRow>(
          `UPDATE lists SET name = ?, color = ?, sort = ?, archived = ?, updated_at = ?, seq = ? WHERE id = ? RETURNING *`,
          l.name,
          l.color,
          l.sort,
          l.archived ? 1 : 0,
          nowIso(),
          seq,
          id,
        )
        .one()
      return listOut(row)
    })
  }

  private deleteList(id: string) {
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      const hit = this.sql.exec(`UPDATE lists SET deleted_at = ?1, updated_at = ?1, seq = ?2 WHERE id = ?3 AND deleted_at IS NULL RETURNING id`, now, seq, id).toArray()
      if (!hit.length) throw new HttpError(404, 'Liste nicht gefunden')
      this.sql.exec(`UPDATE tasks SET list_id = NULL, updated_at = ?1, seq = ?2 WHERE list_id = ?3 AND deleted_at IS NULL`, now, seq, id)
      return { ok: true }
    })
  }

  // -------------------------------------------------------------------------
  // Vorlagen
  // -------------------------------------------------------------------------
  private saveTemplate(id: string | null, body: unknown) {
    const b = (body ?? {}) as { id?: unknown; name?: unknown; payload?: unknown }
    const name = typeof b.name === 'string' ? b.name.trim() : undefined
    if (id === null && (!name || name.length > 100)) throw new HttpError(400, 'Name fehlt oder ist zu lang')
    if (name !== undefined && (name.length < 1 || name.length > 100)) throw new HttpError(400, 'Ungültiger Name')
    const payload = b.payload !== undefined ? cleanTemplatePayload(b.payload) : undefined
    if (id === null && !payload) throw new HttpError(400, 'Inhalt fehlt')
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      if (id === null) {
        const newId = isUuid(b.id) ? b.id : crypto.randomUUID()
        return templateOut(
          this.sql
            .exec<TemplateRow>(`INSERT INTO templates (id, name, payload, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`, newId, name!, JSON.stringify(payload), now, now, seq)
            .one(),
        )
      }
      const cur = this.sql.exec<TemplateRow>(`SELECT * FROM templates WHERE id = ? AND deleted_at IS NULL`, id).toArray()[0]
      if (!cur) throw new HttpError(404, 'Vorlage nicht gefunden')
      return templateOut(
        this.sql
          .exec<TemplateRow>(
            `UPDATE templates SET name = ?, payload = ?, updated_at = ?, seq = ? WHERE id = ? RETURNING *`,
            name ?? cur.name,
            payload ? JSON.stringify(payload) : cur.payload,
            now,
            seq,
            id,
          )
          .one(),
      )
    })
  }

  private deleteTemplate(id: string) {
    return this.tx(() => {
      const hit = this.sql.exec(`UPDATE templates SET deleted_at = ?1, updated_at = ?1, seq = ?2 WHERE id = ?3 AND deleted_at IS NULL RETURNING id`, nowIso(), this.nextSeq(), id).toArray()
      if (!hit.length) throw new HttpError(404, 'Vorlage nicht gefunden')
      return { ok: true }
    })
  }

  // -------------------------------------------------------------------------
  // Einstellungen (zwischen Geräten synchronisiert)
  // -------------------------------------------------------------------------
  private setPref(key: string, body: unknown) {
    const value = (body as { value?: unknown } | null)?.value
    const raw = JSON.stringify(value ?? null)
    if (raw.length > 50_000) throw new HttpError(400, 'Zu groß')
    if (key === 'push') {
      const v = value as { morning?: unknown; evening?: unknown; lead?: unknown; events?: unknown }
      if (v && typeof v === 'object' && 'events' in v && typeof v.events !== 'boolean') throw new HttpError(400, 'Ungültige Benachrichtigungs-Einstellungen')
      const time = (t: unknown) => t === null || (typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      if (!v || typeof v !== 'object' || !time(v.morning ?? null) || !time(v.evening ?? null) || ![0, 5, 10, 15, 30, 60].includes(Number(v.lead ?? 10))) {
        throw new HttpError(400, 'Ungültige Benachrichtigungs-Einstellungen')
      }
    }
    return this.tx(() => {
      this.sql.exec(
        `INSERT INTO prefs (key, value, updated_at, seq) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, seq = excluded.seq`,
        key,
        raw,
        nowIso(),
        this.nextSeq(),
      )
      return { ok: true }
    })
  }

  private pref<T>(key: string, fallback: T): T {
    const r = this.sql.exec<{ value: string }>(`SELECT value FROM prefs WHERE key = ?`, key).toArray()[0]
    if (!r) return fallback
    const v = safeJson(r.value)
    return (v ?? fallback) as T
  }

  // -------------------------------------------------------------------------
  // Push-Benachrichtigungen
  // -------------------------------------------------------------------------
  private kvGet(key: string): string | null {
    return this.sql.exec<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, key).toArray()[0]?.value ?? null
  }

  private kvSet(key: string, value: string) {
    this.sql.exec(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
  }

  private async vapid(): Promise<VapidKeys> {
    const cur = this.kvGet('vapid')
    if (cur) return JSON.parse(cur) as VapidKeys
    const keys = await generateVapidKeys()
    this.kvSet('vapid', JSON.stringify(keys))
    return keys
  }

  private hasPush(): boolean {
    return this.sql.exec(`SELECT 1 FROM push_subscriptions LIMIT 1`).toArray().length > 0
  }

  private pushSettings(): { morning: string | null; evening: string | null; lead: number; events: boolean } {
    const p = this.pref<{ morning?: string | null; evening?: string | null; lead?: number; events?: boolean }>('push', {})
    return { morning: p.morning === undefined ? '08:00' : p.morning, evening: p.evening ?? null, lead: p.lead ?? 10, events: p.events !== false }
  }

  private async pushSubscribe(req: Request, body: unknown) {
    const b = (body ?? {}) as { endpoint?: unknown; timezone?: unknown }
    if (!validEndpoint(b.endpoint)) throw new HttpError(400, 'Ungültiges Abo')
    let tz = typeof b.timezone === 'string' ? b.timezone : 'Europe/Berlin'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
    } catch {
      tz = 'Europe/Berlin'
    }
    this.kvSet('vapid_sub', new URL(req.url).origin)
    const had = this.hasPush()
    this.sql.exec(
      `INSERT INTO push_subscriptions (endpoint, timezone, user_agent, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET timezone = excluded.timezone, created_at = excluded.created_at`,
      b.endpoint,
      tz,
      (req.headers.get('User-Agent') ?? '').slice(0, 200),
      nowIso(),
    )
    // ab jetzt erinnert die App – Google-Termine ohne eigene Erinnerung neu schreiben
    if (!had) {
      this.sql.exec(`UPDATE tasks SET gcal_dirty = 1 WHERE gcal_event_id IS NOT NULL AND deleted_at IS NULL AND status = 'open'`)
      this.queuePush()
    }
    this.planReminders()
    await this.scheduleAlarm()
    return { ok: true }
  }

  private pushUnsubscribe(body: unknown) {
    const endpoint = (body as { endpoint?: unknown } | null)?.endpoint
    const had = this.hasPush()
    if (typeof endpoint === 'string') this.sql.exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint)
    if (had && !this.hasPush()) {
      this.sql.exec(`UPDATE tasks SET gcal_dirty = 1 WHERE gcal_event_id IS NOT NULL AND deleted_at IS NULL AND status = 'open'`)
      this.queuePush()
    }
    this.planReminders()
    return { ok: true }
  }

  /** Vom Service Worker nach einem Push abgefragt: was soll angezeigt werden? */
  private pushPending() {
    const rows = this.sql
      .exec<{ id: string; title: string; body: string; url: string | null; tag: string | null }>(
        `SELECT id, title, body, url, tag FROM notifications WHERE created_at > ? ORDER BY created_at`,
        Date.now() - 3 * MIN,
      )
      .toArray()
    return { notifications: rows }
  }

  private async pushTest() {
    const n = await this.notify([{ title: 'Organizer', body: 'So sehen Erinnerungen aus. 👋', url: '/', tag: 'test' }])
    return { sent: n }
  }

  private async notify(items: { title: string; body: string; url: string; tag: string }[]): Promise<number> {
    if (!items.length) return 0
    const now = Date.now()
    for (const it of items) this.sql.exec(`INSERT INTO notifications (id, title, body, url, tag, created_at) VALUES (?, ?, ?, ?, ?, ?)`, crypto.randomUUID(), it.title, it.body, it.url, it.tag, now)
    this.sql.exec(`DELETE FROM notifications WHERE created_at < ?`, now - DAY)
    const subs = this.sql.exec<{ endpoint: string }>(`SELECT endpoint FROM push_subscriptions`).toArray()
    const keys = await this.vapid()
    const subject = this.kvGet('vapid_sub') ?? 'mailto:organizer@example.invalid'
    let ok = 0
    for (const s of subs) {
      const r = await sendTickle(s.endpoint, keys, subject)
      if (r === 'gone') this.sql.exec(`DELETE FROM push_subscriptions WHERE endpoint = ?`, s.endpoint)
      if (r === 'ok') {
        ok++
        this.sql.exec(`UPDATE push_subscriptions SET last_ok = ? WHERE endpoint = ?`, nowIso(), s.endpoint)
      }
    }
    return ok
  }

  private pushTz(): string | null {
    return this.sql.exec<{ timezone: string }>(`SELECT timezone FROM push_subscriptions ORDER BY created_at DESC LIMIT 1`).toArray()[0]?.timezone ?? null
  }

  private wasSent(key: string) {
    return this.sql.exec(`SELECT 1 FROM reminders_sent WHERE key = ?`, key).toArray().length > 0
  }

  /** Nächsten Erinnerungszeitpunkt berechnen (Aufgaben mit Uhrzeit, Morgenübersicht, Abendrückblick) */
  private planReminders() {
    const tz = this.pushTz()
    if (!tz) {
      this.metaSet('push_at', null)
      return
    }
    const now = Date.now()
    const p = this.pushSettings()
    const due: number[] = []
    const rows = this.sql
      .exec<{ id: string; start_at: string }>(
        `SELECT id, start_at FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND start_at > ? AND start_at < ?`,
        new Date(now - 5 * MIN).toISOString(),
        new Date(now + 3 * DAY).toISOString(),
      )
      .toArray()
    for (const r of rows) {
      const at = Date.parse(r.start_at) - p.lead * MIN
      if (at > now - 5 * MIN && !this.wasSent(`t:${r.id}:${r.start_at}`)) due.push(Math.max(at, now))
    }
    // Google-Termine (Kalender-App-Ersatz)
    if (p.events) {
      for (const e of this.upcomingEvents()) {
        const at = Date.parse(e.start) - p.lead * MIN
        if (at > now - 5 * MIN && !this.wasSent(`ev:${e.cal}:${e.id}:${e.start}`)) due.push(Math.max(at, now))
      }
    }
    // Fristen mit Uhrzeit: eine Stunde vorher
    for (const r of this.timedDeadlines()) {
      const at = zonedToUtc(r.deadline.slice(0, 10), r.deadline.slice(11), tz) - DEADLINE_LEAD
      if (at > now - 5 * MIN && at < now + 3 * DAY && !this.wasSent(`d:${r.id}:${r.deadline}`)) due.push(Math.max(at, now))
    }
    const today = utcToZoned(now, tz).date
    const tomorrow = utcToZoned(now + DAY, tz).date
    for (const [kind, time] of [
      ['m', p.morning],
      ['e', p.evening],
    ] as const) {
      if (!time) continue
      for (const d of [today, tomorrow]) {
        const at = zonedToUtc(d, time, tz)
        if (at > now - 30 * MIN && !this.wasSent(`${kind}:${d}`)) {
          due.push(Math.max(at, now))
          break
        }
      }
    }
    this.metaSet('push_at', due.length ? Math.min(...due) : null)
  }

  private timedDeadlines() {
    return this.sql
      .exec<{ id: string; title: string; deadline: string }>(`SELECT id, title, deadline FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND length(deadline) = 16`)
      .toArray()
  }

  private async sendDueReminders() {
    const tz = this.pushTz()
    if (!tz) return
    const now = Date.now()
    const p = this.pushSettings()
    const items: { title: string; body: string; url: string; tag: string }[] = []
    const mark: string[] = []

    const rows = this.sql
      .exec<TaskRow>(
        `SELECT * FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND start_at > ? AND start_at <= ?`,
        new Date(now - 5 * MIN).toISOString(),
        new Date(now + p.lead * MIN + 30_000).toISOString(),
      )
      .toArray()
    for (const t of rows) {
      const key = `t:${t.id}:${t.start_at}`
      if (this.wasSent(key)) continue
      const { time } = utcToZoned(Date.parse(t.start_at!), tz)
      const end = t.end_at ? utcToZoned(Date.parse(t.end_at), tz).time : null
      const list = t.list_id ? this.sql.exec<{ name: string }>(`SELECT name FROM lists WHERE id = ?`, t.list_id).toArray()[0]?.name : null
      const mins = Math.round((Date.parse(t.start_at!) - now) / MIN)
      items.push({
        title: t.title,
        body: [mins > 1 ? `in ${mins} Min.` : 'jetzt', `${time}${end ? `–${end}` : ''}`, list].filter(Boolean).join(' · '),
        url: `/?task=${t.id}`,
        tag: `task-${t.id}`,
      })
      mark.push(key)
    }
    if (p.events) {
      for (const e of this.upcomingEvents()) {
        const key = `ev:${e.cal}:${e.id}:${e.start}`
        const start = Date.parse(e.start)
        if (this.wasSent(key) || !(start - p.lead * MIN <= now + 30_000 && start > now - 5 * MIN)) continue
        const mins = Math.round((start - now) / MIN)
        const { time } = utcToZoned(start, tz)
        const end = utcToZoned(Date.parse(e.end), tz).time
        items.push({
          title: e.title,
          body: [mins > 1 ? `in ${mins} Min.` : 'jetzt', `${time}–${end}`, e.location].filter(Boolean).join(' · '),
          url: `/?view=calendar&day=${utcToZoned(start, tz).date}`,
          tag: `event-${e.id}`,
        })
        mark.push(key)
      }
    }
    for (const r of this.timedDeadlines()) {
      const key = `d:${r.id}:${r.deadline}`
      const due = zonedToUtc(r.deadline.slice(0, 10), r.deadline.slice(11), tz)
      const at = due - DEADLINE_LEAD
      if (this.wasSent(key) || !(at <= now + 30_000 && at > now - 30 * MIN)) continue
      const mins = Math.max(0, Math.round((due - now) / MIN))
      items.push({
        title: `Frist: ${r.title}`,
        body: mins > 1 ? `noch ${mins} Min. – bis ${r.deadline.slice(11)} Uhr` : `jetzt fällig (${r.deadline.slice(11)} Uhr)`,
        url: `/?task=${r.id}`,
        tag: `deadline-${r.id}`,
      })
      mark.push(key)
    }

    const today = utcToZoned(now, tz).date
    const tomorrow = utcToZoned(now + DAY, tz).date
    const inWindow = (at: number) => at <= now + 30_000 && at > now - 30 * MIN
    if (p.morning && !this.wasSent(`m:${today}`) && inWindow(zonedToUtc(today, p.morning, tz))) {
      const open = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND due_date <= ?`, today).one().n
      const deadlines = this.sql
        .exec<{ title: string; deadline: string }>(`SELECT title, deadline FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND substr(deadline, 1, 10) <= ? ORDER BY deadline LIMIT 2`, tomorrow)
        .toArray()
      let events = 0
      try {
        events = (await this.fetchEvents(today, today)).filter((e) => !e.allDay && utcToZoned(Date.parse(e.start), tz).date === today).length
      } catch {
        /* Google gerade nicht erreichbar */
      }
      const ritual = this.pref<{ planned?: string }>('ritual', {})
      const parts = [open === 1 ? '1 Aufgabe' : `${open} Aufgaben`, events ? `${events} ${events === 1 ? 'Termin' : 'Termine'}` : null]
      const dl = deadlines.map((d) => {
        const day = d.deadline.slice(0, 10)
        const when = day < today ? 'überfällig' : day === today ? 'heute fällig' : 'morgen fällig'
        return `${when}${d.deadline.length > 10 ? ` (${d.deadline.slice(11)})` : ''}: ${d.title}`
      })
      items.push({
        title: 'Guten Morgen – dein Tag',
        body: [parts.filter(Boolean).join(' · '), ...dl].join('\n') + (ritual.planned === today ? '' : '\nTippen, um den Tag zu planen'),
        url: ritual.planned === today ? '/?view=today' : '/?action=plan',
        tag: 'morning',
      })
      mark.push(`m:${today}`)
    }
    if (p.evening && !this.wasSent(`e:${today}`) && inWindow(zonedToUtc(today, p.evening, tz))) {
      const open = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'open' AND due_date <= ?`, today).one().n
      const done = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND status = 'done' AND completed_at >= ?`, new Date(zonedToUtc(today, '00:00', tz)).toISOString()).one().n
      items.push({
        title: 'Tag abschließen?',
        body: `${done} erledigt${open ? ` · ${open} noch offen` : ' – alles geschafft'}`,
        url: '/?action=review',
        tag: 'evening',
      })
      mark.push(`e:${today}`)
    }

    for (const k of mark) this.sql.exec(`INSERT OR REPLACE INTO reminders_sent (key, sent_at) VALUES (?, ?)`, k, now)
    this.sql.exec(`DELETE FROM reminders_sent WHERE sent_at < ?`, now - 7 * DAY)
    await this.notify(items)
  }

  // -------------------------------------------------------------------------
  // Google Kalender – Verbindung
  // -------------------------------------------------------------------------
  private cfg(): GoogleConfig | null {
    return googleConfig(this.env)
  }

  private account(): GoogleAccountRow | null {
    return this.sql.exec<GoogleAccountRow>(`SELECT * FROM google_account WHERE id = 1`).toArray()[0] ?? null
  }

  private async token(): Promise<string> {
    const cfg = this.cfg()
    const acc = this.account()
    if (!cfg || !acc) throw new HttpError(409, 'Google Kalender ist nicht verbunden')
    if (acc.access_token && (acc.access_expires_at ?? 0) > Date.now() + MIN) return acc.access_token
    try {
      const t = await refreshAccessToken(cfg, acc.refresh_token)
      this.sql.exec(
        `UPDATE google_account SET access_token = ?, access_expires_at = ?, status = 'ok', scopes = COALESCE(?, scopes) WHERE id = 1`,
        t.access_token,
        Date.now() + t.expires_in * 1000,
        t.scope ?? null,
      )
      return t.access_token
    } catch (e) {
      if (e instanceof GoogleApiError && (e.reason === 'invalid_grant' || e.status === 400 || e.status === 401)) {
        this.sql.exec(`UPDATE google_account SET status = 'reauth', access_token = NULL WHERE id = 1`)
        throw new HttpError(409, 'Die Verbindung zu Google ist abgelaufen – bitte neu verbinden.')
      }
      throw e
    }
  }

  private async g<T>(method: string, path: string, opts: ApiOpts = {}): Promise<T> {
    const cfg = this.cfg()!
    try {
      return await gapi<T>(cfg, await this.token(), method, path, opts)
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 401) {
        this.sql.exec(`UPDATE google_account SET access_token = NULL WHERE id = 1`)
        return gapi<T>(cfg, await this.token(), method, path, opts)
      }
      throw e
    }
  }

  private async calendars(force = false): Promise<GCalendarListEntry[]> {
    if (!force && this.calendarCache && Date.now() - this.calendarCache.at < 5 * MIN) return this.calendarCache.data
    const items: GCalendarListEntry[] = []
    let pageToken: string | undefined
    do {
      const r = await this.g<{ items: GCalendarListEntry[]; nextPageToken?: string }>('GET', '/users/me/calendarList', { query: { maxResults: '250', pageToken } })
      items.push(...(r.items ?? []))
      pageToken = r.nextPageToken
    } while (pageToken)
    this.calendarCache = { at: Date.now(), data: items }
    return items
  }

  private async googleStatus() {
    const configured = !!this.cfg()
    const acc = this.account()
    if (!configured || !acc) return { configured, connected: false }
    const granted = this.tasksGranted(acc)
    const base = {
      configured,
      connected: true,
      status: acc.status,
      email: acc.email,
      tasks: { granted, enabled: acc.tasks_enabled === 1, problem: acc.tasks_problem },
      events: { granted: this.eventsGranted(acc) },
    }
    if (acc.status !== 'ok') return base
    // halb eingerichtete Aufgaben-Liste nachholen
    if (granted && acc.tasks_enabled === 1 && !acc.tasks_list_id) {
      await this.enableTasks().catch(() => undefined)
      const a = this.account()
      base.tasks = { granted, enabled: a?.tasks_enabled === 1, problem: a?.tasks_problem ?? null }
    }
    try {
      const selected: string[] | null = acc.selected_calendars ? JSON.parse(acc.selected_calendars) : null
      if (!acc.organizer_calendar_id) {
        await this.ensureOrganizerCalendar(await this.calendars(true))
        acc.organizer_calendar_id = this.account()?.organizer_calendar_id ?? null
      }
      const cals = (await this.calendars())
        .filter((c) => c.id !== acc.organizer_calendar_id)
        .map((c) => ({
          id: c.id,
          name: c.summaryOverride ?? c.summary,
          color: c.backgroundColor ?? '#5f6b7a',
          primary: !!c.primary,
          selected: selected ? selected.includes(c.id) : !!c.selected || !!c.primary,
          writable: c.accessRole === 'owner' || c.accessRole === 'writer',
        }))
        .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name))
      return { ...base, calendars: cals }
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) return { ...base, status: 'reauth' }
      if (e instanceof GoogleApiError) {
        console.warn('google status', e.status, e.reason, e.message)
        return { ...base, status: 'reauth', problem: e.reason ?? e.message }
      }
      throw e
    }
  }

  private async googleConnect(url: URL): Promise<Response> {
    const cfg = this.cfg()
    if (!cfg) return redirect('/?google=not-configured')
    const { verifier, challenge } = await pkcePair()
    const state = randomState()
    const redirectUri = `${url.origin}/api/google/callback`
    this.sql.exec(`DELETE FROM oauth_states WHERE created_at < ?`, Date.now() - 60 * MIN)
    this.sql.exec(`INSERT INTO oauth_states (state, verifier, redirect_uri, created_at) VALUES (?, ?, ?, ?)`, state, verifier, redirectUri, Date.now())
    return redirect(buildAuthUrl(cfg, { state, challenge, redirectUri }))
  }

  private async googleCallback(url: URL): Promise<Response> {
    const cfg = this.cfg()
    if (!cfg) return redirect('/?google=not-configured')
    const err = url.searchParams.get('error')
    if (err) return redirect(`/?google=error&reason=${encodeURIComponent(err)}`)
    const state = url.searchParams.get('state') ?? ''
    const code = url.searchParams.get('code') ?? ''
    const row = this.sql.exec<{ verifier: string; redirect_uri: string; created_at: number }>(`SELECT * FROM oauth_states WHERE state = ?`, state).toArray()[0]
    this.sql.exec(`DELETE FROM oauth_states WHERE state = ?`, state)
    if (!row || !code) {
      // Rückruf kam doppelt an (z. B. Browser-Tab und installierte App): war die Verbindung eben erfolgreich, ist alles gut
      if (this.account()?.status === 'ok' && Date.now() - (this.metaGet('gconnected_at') ?? 0) < 10 * MIN) return redirect('/?google=connected')
      return redirect('/?google=error&reason=state')
    }
    if (Date.now() - row.created_at > 60 * MIN) return redirect('/?google=error&reason=expired')

    try {
      const t = await exchangeCode(cfg, code, row.verifier, row.redirect_uri)
      const existing = this.account()
      const refresh = t.refresh_token ?? existing?.refresh_token
      if (!refresh) return redirect('/?google=error&reason=no_refresh_token')
      this.sql.exec(
        `INSERT INTO google_account (id, refresh_token, access_token, access_expires_at, status, connected_at, scopes)
         VALUES (1, ?, ?, ?, 'ok', ?, ?)
         ON CONFLICT (id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
           access_expires_at = excluded.access_expires_at, status = 'ok', scopes = excluded.scopes`,
        refresh,
        t.access_token,
        Date.now() + t.expires_in * 1000,
        nowIso(),
        t.scope ?? SCOPES.join(' '),
      )
      this.calendarCache = null
      this.eventCache.clear()
      await this.ensureOrganizerCalendar(await this.calendars(true))
      // Google Aufgaben: beim ersten Mal mit Berechtigung automatisch an (außer bewusst ausgeschaltet)
      const acc = this.account()
      if (acc && this.tasksGranted(acc) && acc.tasks_enabled !== 0) await this.enableTasks().catch((e) => console.warn('tasks enable', e))
      this.metaSet('gconnected_at', Date.now())
      return redirect('/?google=connected')
    } catch (e) {
      console.error('google callback', e)
      const reason = e instanceof GoogleApiError ? e.reason ?? String(e.status) : 'unknown'
      return redirect(`/?google=error&reason=${encodeURIComponent(reason)}`)
    }
  }

  /** Eigenen Kalender „Organizer“ finden oder anlegen und alle geplanten Aufgaben einmal übertragen */
  private async ensureOrganizerCalendar(cals: GCalendarListEntry[]) {
    const primary = cals.find((c) => c.primary)
    let organizer = cals.find((c) => c.description?.includes(ORGANIZER_CALENDAR_MARK) && c.accessRole === 'owner')
    if (!organizer) {
      const created = await this.g<{ id: string }>('POST', '/calendars', {
        body: {
          summary: ORGANIZER_CALENDAR_NAME,
          description: `Aufgaben mit Uhrzeit aus deinem Organizer. (${ORGANIZER_CALENDAR_MARK})`,
          timeZone: 'Europe/Berlin',
        },
      })
      organizer = { id: created.id, summary: ORGANIZER_CALENDAR_NAME, accessRole: 'owner' }
      this.calendarCache = null
    }
    this.sql.exec(`UPDATE google_account SET email = ?, organizer_calendar_id = ?, sync_token = NULL WHERE id = 1`, primary?.id ?? null, organizer.id)
    this.sql.exec(`UPDATE tasks SET gcal_dirty = 1 WHERE deleted_at IS NULL AND start_at IS NOT NULL`)
    this.metaSet('gpull_at', Date.now() + 5000)
    this.metaSet('gpush_at', Date.now() + 1000)
    await this.scheduleAlarm()
  }

  private async googleDisconnect() {
    const cfg = this.cfg()
    const acc = this.account()
    if (cfg && acc) await revokeToken(cfg, acc.refresh_token)
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM google_account`)
      this.sql.exec(`UPDATE tasks SET gcal_event_id = NULL, gcal_etag = NULL, gcal_dirty = 0, gtask_id = NULL, gtask_updated = NULL, gtask_dirty = 0`)
      this.metaSet('gpull_at', null)
      this.metaSet('gpush_at', null)
    })
    this.eventCache.clear()
    this.calendarCache = null
    return { ok: true }
  }

  private googleSetCalendars(body: unknown) {
    const sel = (body as { selected?: unknown } | null)?.selected
    if (!Array.isArray(sel) || sel.length > 100 || !sel.every((s) => typeof s === 'string' && s.length < 300)) throw new HttpError(400, 'Ungültige Auswahl')
    if (!this.account()) throw new HttpError(409, 'Google Kalender ist nicht verbunden')
    this.sql.exec(`UPDATE google_account SET selected_calendars = ? WHERE id = 1`, JSON.stringify(sel))
    this.eventCache.clear()
    return { ok: true }
  }

  // -------------------------------------------------------------------------
  // Google Kalender – Termine anzeigen
  // -------------------------------------------------------------------------
  private async googleEvents(url: URL): Promise<{ events: CalendarEventOut[] }> {
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to) || daysBetween(from, to) < 0 || daysBetween(from, to) > 400) throw new HttpError(400, 'Ungültiger Zeitraum')
    return { events: await this.fetchEvents(from, to) }
  }

  private eventsGranted(acc: GoogleAccountRow | null): boolean {
    return !!acc?.scopes?.split(/\s+/).includes(EVENTS_SCOPE)
  }

  /** Google-Termin → Format der App */
  private eventOut(c: GCalendarListEntry, e: GEvent): CalendarEventOut | null {
    if (e.status === 'cancelled' || !e.start || !e.end) return null
    const allDay = !!e.start.date
    const meet = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null
    return {
      id: e.id,
      calendarId: c.id,
      calendarName: c.summaryOverride ?? c.summary,
      title: e.summary?.trim() || '(ohne Titel)',
      start: allDay ? e.start.date! : e.start.dateTime!,
      end: allDay ? e.end.date! : e.end.dateTime!,
      allDay,
      color: (e.colorId && EVENT_COLORS[e.colorId]) || c.backgroundColor || '#5f6b7a',
      location: e.location ?? null,
      link: e.htmlLink ?? null,
      description: e.description ? e.description.slice(0, 4000) : null,
      writable: (c.accessRole === 'owner' || c.accessRole === 'writer') && this.eventsGranted(this.account()),
      colorId: e.colorId ?? null,
      recurringId: e.recurringEventId ?? null,
      meet,
      guests: (e.attendees ?? []).filter((a) => !a.self).length,
    }
  }

  /** Suche in den sichtbaren Kalendern (ein Jahr zurück, ein Jahr voraus) */
  private async searchEvents(q: string): Promise<{ events: CalendarEventOut[] }> {
    const acc = this.account()
    if (!acc || !this.cfg() || acc.status !== 'ok') return { events: [] }
    const selected: string[] | null = acc.selected_calendars ? JSON.parse(acc.selected_calendars) : null
    const cals = (await this.calendars()).filter((c) => c.id !== acc.organizer_calendar_id && (selected ? selected.includes(c.id) : c.selected || c.primary))
    const now = Date.now()
    const lists = await Promise.all(
      cals.map((c) =>
        this.g<GEventList>('GET', `/calendars/${encodeURIComponent(c.id)}/events`, {
          query: { q, timeMin: new Date(now - 365 * DAY).toISOString(), timeMax: new Date(now + 365 * DAY).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' },
        })
          .then((r) => ({ c, items: r.items ?? [] }))
          .catch(() => ({ c, items: [] as GEvent[] })),
      ),
    )
    const out: CalendarEventOut[] = []
    for (const { c, items } of lists) for (const e of items) {
      const ev = this.eventOut(c, e)
      if (ev) out.push(ev)
    }
    out.sort((a, b) => a.start.localeCompare(b.start))
    return { events: out.slice(0, 100) }
  }

  private async writableCalendar(id: unknown): Promise<GCalendarListEntry> {
    if (!this.eventsGranted(this.account())) throw new HttpError(403, 'Für Termine bitte Google einmal neu verbinden (Berechtigung „Termine bearbeiten“).')
    if (typeof id !== 'string' || id.length > 300) throw new HttpError(400, 'Ungültiger Kalender')
    const c = (await this.calendars()).find((x) => x.id === id)
    if (!c) throw new HttpError(404, 'Kalender nicht gefunden')
    if (c.accessRole !== 'owner' && c.accessRole !== 'writer') throw new HttpError(403, 'In diesem Kalender darfst du nichts ändern')
    return c
  }

  /** Eingaben für einen Termin prüfen und in Googles Format bringen */
  private eventBody(b: Record<string, unknown>, partial: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if ('title' in b) {
      const t = typeof b.title === 'string' ? b.title.trim().slice(0, 500) : ''
      if (!t) throw new HttpError(400, 'Titel fehlt')
      out.summary = t
    } else if (!partial) throw new HttpError(400, 'Titel fehlt')
    if ('location' in b) out.location = typeof b.location === 'string' ? b.location.slice(0, 500) : null
    if ('description' in b) out.description = typeof b.description === 'string' ? b.description.slice(0, 8000) : null
    if ('colorId' in b) {
      if (b.colorId !== null && !(typeof b.colorId === 'string' && EVENT_COLORS[b.colorId])) throw new HttpError(400, 'Ungültige Farbe')
      out.colorId = b.colorId
    }
    if ('start' in b || 'end' in b || !partial) {
      const allDay = b.allDay === true
      const tz = typeof b.timeZone === 'string' && b.timeZone.length < 60 ? b.timeZone : 'Europe/Berlin'
      if (allDay) {
        if (!isDate(b.start) || !isDate(b.end) || (b.end as string) <= (b.start as string)) throw new HttpError(400, 'Ungültige Tage')
        out.start = { date: b.start, dateTime: null }
        out.end = { date: b.end, dateTime: null }
      } else {
        const s = typeof b.start === 'string' ? Date.parse(b.start) : NaN
        const e = typeof b.end === 'string' ? Date.parse(b.end) : NaN
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || e - s > 31 * DAY) throw new HttpError(400, 'Ungültige Zeit')
        out.start = { dateTime: new Date(s).toISOString(), timeZone: tz, date: null }
        out.end = { dateTime: new Date(e).toISOString(), timeZone: tz, date: null }
      }
    }
    if ('recurrence' in b) {
      const r = b.recurrence
      if (r !== null && !(typeof r === 'string' && /^RRULE:[A-Z0-9=;,+-]{3,200}$/i.test(r))) throw new HttpError(400, 'Ungültige Wiederholung')
      out.recurrence = r ? [r.toUpperCase()] : []
    }
    if ('reminders' in b) {
      const m = b.reminders
      if (m === null) out.reminders = { useDefault: true }
      else if (Array.isArray(m) && m.length <= 5 && m.every((x) => Number.isInteger(x) && x >= 0 && x <= 40320)) out.reminders = { useDefault: false, overrides: (m as number[]).map((x) => ({ method: 'popup', minutes: x })) }
      else throw new HttpError(400, 'Ungültige Erinnerung')
    }
    return out
  }

  private async createEvent(body: unknown): Promise<CalendarEventOut> {
    const b = (body ?? {}) as Record<string, unknown>
    const c = await this.writableCalendar(b.calendarId)
    const ev = await this.g<GEvent>('POST', `/calendars/${encodeURIComponent(c.id)}/events`, { body: this.eventBody(b, false) })
    this.eventCache.clear()
    return this.eventOut(c, ev)!
  }

  /** Termin ändern; mit `all` bei Serien den ganzen Ursprungstermin, mit `toCalendar` in einen anderen Kalender verschieben */
  private async updateEvent(body: unknown): Promise<CalendarEventOut | { ok: true }> {
    const b = (body ?? {}) as Record<string, unknown>
    const c = await this.writableCalendar(b.calendarId)
    if (typeof b.id !== 'string' || b.id.length > 1100) throw new HttpError(400, 'Ungültiger Termin')
    let id = b.id
    if (b.all === true && typeof b.recurringId === 'string') id = b.recurringId
    const patch = this.eventBody((b.patch ?? {}) as Record<string, unknown>, true)
    let ev: GEvent | null = null
    if (Object.keys(patch).length) {
      // ganze Serie verschieben: nur die Uhrzeit übernehmen, das Datum des Ursprungs behalten
      if (b.all === true && id !== b.id && (patch.start || patch.end)) {
        const orig = await this.g<GEvent>('GET', `/calendars/${encodeURIComponent(c.id)}/events/${encodeURIComponent(id)}`)
        const shift = (t: { dateTime?: string | null; date?: string | null; timeZone?: string }, o?: GEventTime) => {
          if (!t.dateTime || !o?.dateTime) return t
          const n = new Date(t.dateTime)
          const od = new Date(o.dateTime)
          od.setUTCHours(n.getUTCHours(), n.getUTCMinutes(), 0, 0)
          return { ...t, dateTime: od.toISOString() }
        }
        if (patch.start) patch.start = shift(patch.start as never, orig.start)
        if (patch.end) patch.end = shift(patch.end as never, orig.end)
      }
      ev = await this.g<GEvent>('PATCH', `/calendars/${encodeURIComponent(c.id)}/events/${encodeURIComponent(id)}`, { body: patch })
    }
    let cal = c
    if (typeof b.toCalendar === 'string' && b.toCalendar !== c.id) {
      cal = await this.writableCalendar(b.toCalendar)
      ev = await this.g<GEvent>('POST', `/calendars/${encodeURIComponent(c.id)}/events/${encodeURIComponent(id)}/move`, { query: { destination: cal.id } })
    }
    this.eventCache.clear()
    return ev ? (this.eventOut(cal, ev) ?? { ok: true }) : { ok: true }
  }

  private async deleteEvent(body: unknown): Promise<{ ok: true }> {
    const b = (body ?? {}) as Record<string, unknown>
    const c = await this.writableCalendar(b.calendarId)
    if (typeof b.id !== 'string' || b.id.length > 1100) throw new HttpError(400, 'Ungültiger Termin')
    const id = b.all === true && typeof b.recurringId === 'string' ? b.recurringId : b.id
    try {
      await this.g('DELETE', `/calendars/${encodeURIComponent(c.id)}/events/${encodeURIComponent(id)}`)
    } catch (e) {
      if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) throw e
    }
    this.eventCache.clear()
    return { ok: true }
  }

  /** Termine der nächsten Stunden merken – für Erinnerungen per Push */
  private async refreshUpcoming() {
    const acc = this.account()
    if (!acc || acc.status !== 'ok' || !this.pushTz() || this.pushSettings().events === false) return
    const tz = this.pushTz()!
    const now = Date.now()
    const today = utcToZoned(now, tz).date
    const tomorrow = utcToZoned(now + DAY, tz).date
    const evs = await this.fetchEvents(today, tomorrow)
    const soon = evs
      .filter((e) => !e.allDay && Date.parse(e.start) > now - 5 * MIN && Date.parse(e.start) < now + 26 * 60 * MIN)
      .map((e) => ({ id: e.id, cal: e.calendarId, title: e.title, start: e.start, end: e.end, location: e.location }))
    this.kvSet('upcoming_events', JSON.stringify(soon.slice(0, 100)))
  }

  private upcomingEvents(): { id: string; cal: string; title: string; start: string; end: string; location: string | null }[] {
    try {
      return JSON.parse(this.kvGet('upcoming_events') ?? '[]')
    } catch {
      return []
    }
  }

  private async fetchEvents(from: string, to: string): Promise<CalendarEventOut[]> {
    const acc = this.account()
    if (!acc || !this.cfg() || acc.status !== 'ok') return []
    const key = `${from}|${to}`
    const hit = this.eventCache.get(key)
    if (hit && Date.now() - hit.at < 90_000) return hit.data

    const selected: string[] | null = acc.selected_calendars ? JSON.parse(acc.selected_calendars) : null
    const cals = (await this.calendars()).filter((c) => c.id !== acc.organizer_calendar_id && (selected ? selected.includes(c.id) : c.selected || c.primary))
    // großzügig einen Tag davor/danach holen, die App filtert nach Ortszeit
    const timeMin = new Date(Date.parse(from) - DAY).toISOString()
    const timeMax = new Date(Date.parse(to) + 2 * DAY).toISOString()
    const fetchAll = async (c: GCalendarListEntry) => {
      const items: GEvent[] = []
      let pageToken: string | undefined
      let guard = 0
      do {
        const r = await this.g<GEventList>('GET', `/calendars/${encodeURIComponent(c.id)}/events`, {
          query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', pageToken },
        })
        items.push(...(r.items ?? []))
        pageToken = r.nextPageToken
      } while (pageToken && ++guard < 5)
      return items
    }
    const lists = await Promise.all(
      cals.map((c) =>
        fetchAll(c)
          .then((items) => ({ c, items }))
          .catch((e) => {
            console.warn('events', c.id, e)
            return { c, items: [] as GEvent[] }
          }),
      ),
    )
    const events: CalendarEventOut[] = []
    for (const { c, items } of lists) {
      for (const e of items) {
        const ev = this.eventOut(c, e)
        if (ev) events.push(ev)
      }
    }
    this.eventCache.set(key, { at: Date.now(), data: events })
    if (this.eventCache.size > 20) this.eventCache.delete(this.eventCache.keys().next().value!)
    return events
  }

  // -------------------------------------------------------------------------
  // Google Kalender – Aufgaben mit Uhrzeit hinschreiben
  // -------------------------------------------------------------------------
  private queuePush() {
    const acc = this.account()
    if (!acc || acc.status !== 'ok') return
    const cal = !!acc.organizer_calendar_id && this.sql.exec(`SELECT 1 FROM tasks WHERE gcal_dirty = 1 LIMIT 1`).toArray().length > 0
    const tasks = this.tasksActive(acc) && this.sql.exec(`SELECT 1 FROM tasks WHERE gtask_dirty = 1 LIMIT 1`).toArray().length > 0
    if (cal || tasks) this.ctx.waitUntil(this.pushGoogle())
  }

  private pushGoogle(): Promise<void> {
    this.pushing ??= this.doPush().finally(() => {
      this.pushing = null
    })
    return this.pushing
  }

  /** Titel für Google: Teile bekommen „(Teil 1/3)“ angehängt */
  private displayTitle(t: TaskRow): string {
    if (t.part_index === null || !t.parent_id) return t.title
    const r = this.sql
      .exec<{ n: number; i: number }>(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN part_index <= ? THEN 1 ELSE 0 END) AS i FROM tasks WHERE parent_id = ? AND part_index IS NOT NULL AND deleted_at IS NULL`,
        t.part_index,
        t.parent_id,
      )
      .one()
    return r.n > 1 ? `${t.title} (Teil ${r.i}/${r.n})` : t.title
  }

  private async doPush() {
    await this.pushCalendar()
    await this.pushTasks()
  }

  private async pushCalendar() {
    const acc = this.account()
    if (!acc || acc.status !== 'ok' || !acc.organizer_calendar_id || !this.cfg()) return
    const cal = encodeURIComponent(acc.organizer_calendar_id)
    let failed = false
    for (let round = 0; round < 10; round++) {
      const rows = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE gcal_dirty = 1 ORDER BY updated_at LIMIT 20`).toArray()
      if (!rows.length) break
      for (const t of rows) {
        try {
          const want = !t.deleted_at && t.start_at && t.end_at
          let eventId = t.gcal_event_id
          let etag = t.gcal_etag
          if (want) {
            const body = {
              summary: (t.status === 'done' ? '✓ ' : '') + this.displayTitle(t),
              description: [t.notes, 'Aus deinem Organizer'].filter(Boolean).join('\n\n'),
              start: { dateTime: t.start_at, timeZone: t.timezone ?? 'UTC' },
              end: { dateTime: t.end_at, timeZone: t.timezone ?? 'UTC' },
              extendedProperties: { private: { organizerTaskId: t.id } },
              // Erinnerung aufs Handy 10 Minuten vorher (über die Google-Kalender-App), erledigte ohne
              reminders: { useDefault: false, overrides: t.status === 'done' || this.hasPush() ? [] : [{ method: 'popup', minutes: 10 }] },
            }
            let ev: GEvent | null = null
            if (eventId) {
              ev = await this.g<GEvent>('PATCH', `/calendars/${cal}/events/${encodeURIComponent(eventId)}`, { body }).catch((e) => {
                if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return null
                throw e
              })
            }
            ev ??= await this.g<GEvent>('POST', `/calendars/${cal}/events`, { body })
            eventId = ev.id
            etag = ev.etag
          } else if (eventId) {
            await this.g('DELETE', `/calendars/${cal}/events/${encodeURIComponent(eventId)}`).catch((e) => {
              if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return
              throw e
            })
            eventId = null
            etag = null
          }
          // Termin-Daten immer speichern; „dirty“ nur zurücksetzen, wenn sich die Aufgabe inzwischen nicht geändert hat
          this.sql.exec(
            `UPDATE tasks SET gcal_event_id = ?, gcal_etag = ?, gcal_dirty = CASE WHEN updated_at = ? THEN 0 ELSE gcal_dirty END WHERE id = ?`,
            eventId,
            etag,
            t.updated_at,
            t.id,
          )
        } catch (e) {
          console.warn('push', t.id, e)
          failed = true
          if (e instanceof HttpError && e.status === 409) return // Verbindung abgelaufen
        }
      }
      if (failed) break
    }
    if (failed) {
      this.metaSet('gpush_at', Date.now() + 5 * MIN)
      await this.scheduleAlarm()
    }
  }

  // -------------------------------------------------------------------------
  // Google Kalender – Änderungen aus Google übernehmen (Verschieben/Löschen im Organizer-Kalender)
  // -------------------------------------------------------------------------
  private async pullAndBroadcast() {
    const changed = await this.pullGoogle().catch((e) => {
      console.warn('pull', e)
      return false
    })
    if (changed) this.broadcast()
  }

  private pullGoogle(): Promise<boolean> {
    this.pulling ??= this.doPull().finally(() => {
      this.pulling = null
    })
    return this.pulling
  }

  private async doPull(): Promise<boolean> {
    const acc = this.account()
    if (!acc || acc.status !== 'ok' || !this.cfg()) return false
    this.lastPull = Date.now()
    if (this.pushing) await this.pushing
    let changed = false
    if (acc.organizer_calendar_id) changed = await this.pullCalendar(acc)
    if (this.tasksActive(this.account())) {
      try {
        changed = (await this.pullTasks()) || changed
      } catch (e) {
        console.warn('tasks pull', e)
      }
    }
    try {
      await this.refreshUpcoming()
      this.planReminders()
    } catch (e) {
      console.warn('upcoming', e)
    }
    if (this.metaGet('gpull_at') === null) {
      this.metaSet('gpull_at', Date.now() + PULL_EVERY)
      await this.scheduleAlarm()
    }
    return changed
  }

  private async pullCalendar(acc: GoogleAccountRow): Promise<boolean> {
    const cal = encodeURIComponent(acc.organizer_calendar_id ?? '')
    const items: GEvent[] = []
    const syncToken = acc.sync_token
    let pageToken: string | undefined
    let nextSync: string | undefined
    try {
      do {
        const r = await this.g<GEventList>('GET', `/calendars/${cal}/events`, {
          query: syncToken
            ? { syncToken, pageToken, maxResults: '250' }
            : { pageToken, maxResults: '250', showDeleted: 'true', singleEvents: 'true', timeMin: new Date(Date.now() - 90 * DAY).toISOString() },
        })
        items.push(...(r.items ?? []))
        pageToken = r.nextPageToken
        nextSync = r.nextSyncToken ?? nextSync
      } while (pageToken)
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 410) {
        this.sql.exec(`UPDATE google_account SET sync_token = NULL WHERE id = 1`)
        return this.pullCalendar({ ...acc, sync_token: null })
      }
      throw e
    }

    let changed = false
    this.ctx.storage.transactionSync(() => {
      const now = nowIso()
      let seq: number | null = null
      const bump = () => (seq ??= this.nextSeq())
      for (const ev of items) {
        const taskId = ev.extendedProperties?.private?.organizerTaskId
        const t =
          (taskId && this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, taskId).toArray()[0]) ||
          this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE gcal_event_id = ?`, ev.id).toArray()[0]

        if (!t) {
          // Termin direkt in Google im Organizer-Kalender angelegt → wird zur Aufgabe
          if (ev.status === 'cancelled' || !ev.start || !syncToken) continue
          const id = crypto.randomUUID()
          const tz = ev.start.timeZone ?? 'UTC'
          const timed = !!ev.start.dateTime
          this.sql.exec(
            `INSERT INTO tasks (id, title, notes, status, prio, horizon, tags, due_date, start_at, end_at, timezone, sort,
               created_at, updated_at, seq, gcal_event_id, gcal_etag, gcal_dirty, origin_event_id, num)
             VALUES (?, ?, ?, 'open', 0, 'backlog', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            id,
            (ev.summary ?? '').trim() || '(ohne Titel)',
            ev.description ?? null,
            timed ? dateInZone(ev.start.dateTime!, tz) : ev.start.date!,
            timed ? new Date(ev.start.dateTime!).toISOString() : null,
            timed ? new Date(ev.end!.dateTime!).toISOString() : null,
            timed ? tz : null,
            Date.now(),
            now,
            now,
            bump(),
            ev.id,
            ev.etag,
            ev.id,
            this.nextNum(),
          )
          changed = true
          continue
        }
        if (t.gcal_dirty || t.deleted_at) continue // lokale Änderung gewinnt, wird gleich übertragen
        if (ev.status === 'cancelled') {
          if (!t.gcal_event_id) continue
          // Termin in Google gelöscht → Aufgabe behält ihren Tag, verliert nur die Uhrzeit
          this.sql.exec(`UPDATE tasks SET start_at = NULL, end_at = NULL, timezone = NULL, gcal_event_id = NULL, gcal_etag = NULL, updated_at = ?, seq = ? WHERE id = ?`, now, bump(), t.id)
          changed = true
          continue
        }
        if (ev.etag === t.gcal_etag) continue // eigene Änderung
        const title = (ev.summary ?? '').replace(/^✓\s*/, '').trim() || t.title
        if (ev.start?.dateTime && ev.end?.dateTime) {
          const tz = ev.start.timeZone ?? t.timezone ?? 'UTC'
          const start = new Date(ev.start.dateTime).toISOString()
          const end = new Date(ev.end.dateTime).toISOString()
          if (start !== t.start_at || end !== t.end_at || title !== t.title) {
            this.sql.exec(
              `UPDATE tasks SET title = ?, start_at = ?, end_at = ?, timezone = ?, due_date = ?, gcal_event_id = ?, gcal_etag = ?, updated_at = ?, seq = ? WHERE id = ?`,
              title,
              start,
              end,
              tz,
              dateInZone(start, tz),
              ev.id,
              ev.etag,
              now,
              bump(),
              t.id,
            )
            changed = true
          } else {
            this.sql.exec(`UPDATE tasks SET gcal_etag = ? WHERE id = ?`, ev.etag, t.id)
          }
        } else if (ev.start?.date) {
          // in Google zu einem ganztägigen Termin gemacht
          this.sql.exec(
            `UPDATE tasks SET title = ?, start_at = NULL, end_at = NULL, timezone = NULL, due_date = ?, gcal_etag = ?, updated_at = ?, seq = ? WHERE id = ?`,
            title,
            ev.start.date,
            ev.etag,
            now,
            bump(),
            t.id,
          )
          changed = true
        }
      }
      if (nextSync) this.sql.exec(`UPDATE google_account SET sync_token = ? WHERE id = 1`, nextSync)
    })
    return changed
  }

  // -------------------------------------------------------------------------
  // Google Aufgaben – Aufgaben mit Tag (ohne Uhrzeit) in der Liste „Organizer“
  // -------------------------------------------------------------------------
  private tasksGranted(acc: GoogleAccountRow | null): boolean {
    return !!acc?.scopes?.split(/\s+/).includes(TASKS_SCOPE)
  }

  private tasksActive(acc: GoogleAccountRow | null): acc is GoogleAccountRow & { tasks_list_id: string } {
    return !!acc && acc.status === 'ok' && acc.tasks_enabled === 1 && !!acc.tasks_list_id && this.tasksGranted(acc)
  }

  private taskProblem(e: unknown): string {
    if (e instanceof GoogleApiError) {
      if (e.status === 403 && /accessNotConfigured|SERVICE_DISABLED|disabled/i.test(`${e.reason} ${e.message}`)) return 'api-disabled'
      if (e.status === 403 || e.status === 401) return 'scope'
      return e.reason ?? e.message
    }
    if (e instanceof HttpError && e.status === 409) return 'reauth'
    return e instanceof Error ? e.message : String(e)
  }

  /** Liste „Organizer“ finden/anlegen, alle offenen Aufgaben mit Tag vormerken */
  private async enableTasks() {
    const acc = this.account()
    if (!acc) throw new HttpError(409, 'Google ist nicht verbunden')
    if (!this.tasksGranted(acc)) throw new HttpError(409, 'Für Google Aufgaben fehlt die Berechtigung – bitte Google neu verbinden.')
    try {
      let listId = acc.tasks_list_id
      if (!listId) {
        const lists: GTaskList[] = []
        let pageToken: string | undefined
        do {
          const r = await this.g<{ items?: GTaskList[]; nextPageToken?: string }>('GET', '/users/@me/lists', { api: 'tasks', query: { maxResults: '100', pageToken } })
          lists.push(...(r.items ?? []))
          pageToken = r.nextPageToken
        } while (pageToken)
        listId = lists.find((l) => l.title === LANE)?.id ?? (await this.g<GTaskList>('POST', '/users/@me/lists', { api: 'tasks', body: { title: LANE } })).id
      }
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(`UPDATE google_account SET tasks_list_id = ?, tasks_enabled = 1, tasks_problem = NULL, tasks_cursor = NULL WHERE id = 1`, listId)
        this.sql.exec(`UPDATE tasks SET gtask_dirty = 1 WHERE deleted_at IS NULL AND status = 'open' AND due_date IS NOT NULL AND start_at IS NULL`)
      })
    } catch (e) {
      this.sql.exec(`UPDATE google_account SET tasks_problem = ? WHERE id = 1`, this.taskProblem(e))
      throw e
    }
    this.metaSet('gpush_at', Date.now() + 500)
    this.metaSet('gpull_at', Date.now() + 5000)
    await this.scheduleAlarm()
  }

  private async disableTasks() {
    const acc = this.account()
    if (acc?.tasks_list_id && this.tasksGranted(acc)) {
      // die ganze Liste in Google entfernen – die Aufgaben bleiben in der App
      await this.g('DELETE', `/users/@me/lists/${encodeURIComponent(acc.tasks_list_id)}`, { api: 'tasks' }).catch((e) => {
        if (!(e instanceof GoogleApiError && (e.status === 404 || e.status === 410))) console.warn('tasks list delete', e)
      })
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`UPDATE google_account SET tasks_enabled = 0, tasks_list_id = NULL, tasks_cursor = NULL, tasks_problem = NULL WHERE id = 1`)
      this.sql.exec(`UPDATE tasks SET gtask_id = NULL, gtask_updated = NULL, gtask_dirty = 0`)
    })
  }

  private async googleTasksToggle(body: unknown) {
    const enabled = (body as { enabled?: unknown } | null)?.enabled
    if (typeof enabled !== 'boolean') throw new HttpError(400, 'enabled fehlt')
    if (!this.account()) throw new HttpError(409, 'Google ist nicht verbunden')
    if (enabled) {
      try {
        await this.enableTasks()
      } catch (e) {
        if (e instanceof HttpError) throw e
        const p = this.taskProblem(e)
        throw new HttpError(
          502,
          p === 'api-disabled'
            ? 'Die Google Tasks API ist in deinem Google-Cloud-Projekt noch nicht aktiviert.'
            : p === 'scope'
              ? 'Google erlaubt der App den Zugriff auf Aufgaben nicht – bitte neu verbinden und den Haken bei „Aufgaben“ setzen.'
              : `Google Aufgaben: ${p}`,
        )
      }
    } else await this.disableTasks()
    return this.googleStatus()
  }

  private async pushTasks() {
    const acc = this.account()
    if (!this.tasksActive(acc) || !this.cfg()) return
    const list = encodeURIComponent(acc.tasks_list_id)
    let failed = false
    for (let round = 0; round < 10 && !failed; round++) {
      const rows = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE gtask_dirty = 1 ORDER BY updated_at LIMIT 25`).toArray()
      if (!rows.length) break
      for (const t of rows) {
        try {
          // einmal verknüpft, bleibt sie in Google, bis sie gelöscht wird oder eine Uhrzeit bekommt
          const want = !t.deleted_at && !t.start_at && (t.gtask_id ? true : !!t.due_date && t.status === 'open')
          let gid = t.gtask_id
          let updated = t.gtask_updated
          if (want) {
            const body: Record<string, unknown> = {
              title: this.displayTitle(t).slice(0, 1024),
              notes: (t.notes ?? '').slice(0, 8000),
              due: t.due_date ? `${t.due_date}T00:00:00.000Z` : null,
              status: t.status === 'done' ? 'completed' : 'needsAction',
            }
            if (t.status === 'open') body.completed = null
            let res: GTask | null = null
            if (gid) {
              res = await this.g<GTask>('PATCH', `/lists/${list}/tasks/${encodeURIComponent(gid)}`, { api: 'tasks', body }).catch((e) => {
                if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return null
                throw e
              })
            }
            if (!res) {
              if (!body.due) delete body.due
              delete body.completed
              res = await this.g<GTask>('POST', `/lists/${list}/tasks`, { api: 'tasks', body })
            }
            gid = res.id
            updated = res.updated
          } else if (gid) {
            await this.g('DELETE', `/lists/${list}/tasks/${encodeURIComponent(gid)}`, { api: 'tasks' }).catch((e) => {
              if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return
              throw e
            })
            gid = null
            updated = null
          }
          this.sql.exec(
            `UPDATE tasks SET gtask_id = ?, gtask_updated = ?, gtask_dirty = CASE WHEN updated_at = ? THEN 0 ELSE gtask_dirty END WHERE id = ?`,
            gid,
            updated,
            t.updated_at,
            t.id,
          )
        } catch (e) {
          console.warn('tasks push', t.id, e)
          failed = true
          const p = this.taskProblem(e)
          if (p === 'api-disabled' || p === 'scope') this.sql.exec(`UPDATE google_account SET tasks_problem = ? WHERE id = 1`, p)
          break
        }
      }
    }
    if (failed) {
      this.metaSet('gpush_at', Date.now() + 5 * MIN)
      await this.scheduleAlarm()
    } else if (acc.tasks_problem) this.sql.exec(`UPDATE google_account SET tasks_problem = NULL WHERE id = 1`)
  }

  /** Änderungen aus Google Aufgaben: abgehakt, umbenannt, verschoben, neu, gelöscht */
  private async pullTasks(): Promise<boolean> {
    const acc = this.account()
    if (!this.tasksActive(acc)) return false
    const list = encodeURIComponent(acc.tasks_list_id)
    const since = acc.tasks_cursor
    const items: GTask[] = []
    let pageToken: string | undefined
    do {
      const r = await this.g<{ items?: GTask[]; nextPageToken?: string }>('GET', `/lists/${list}/tasks`, {
        api: 'tasks',
        query: { maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: since ? 'true' : 'false', updatedMin: since ?? undefined, pageToken },
      })
      items.push(...(r.items ?? []))
      pageToken = r.nextPageToken
    } while (pageToken)

    const tz = this.pushTz() ?? 'Europe/Berlin'
    const today = utcToZoned(Date.now(), tz).date
    const complete: { id: string; updated: string; recurring: boolean }[] = []
    const reopen: { id: string; updated: string }[] = []
    let changed = false
    let cursor = since
    this.ctx.storage.transactionSync(() => {
      const now = nowIso()
      let seq: number | null = null
      const bump = () => (seq ??= this.nextSeq())
      for (const it of items) {
        if (!cursor || it.updated > cursor) cursor = it.updated
        const t = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE gtask_id = ?`, it.id).toArray()[0]
        const due = it.due ? it.due.slice(0, 10) : null
        if (!t) {
          // direkt in Google in der Liste „Organizer“ angelegt → neue Aufgabe
          const title = (it.title ?? '').trim()
          if (it.deleted || it.status === 'completed' || !title) continue
          this.sql.exec(
            `INSERT INTO tasks (id, title, notes, status, prio, horizon, tags, blocked_by, due_date, sort, num, created_at, updated_at, seq, gtask_id, gtask_updated, gtask_dirty)
             VALUES (?, ?, ?, 'open', 0, 'backlog', '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            crypto.randomUUID(),
            title.slice(0, 500),
            it.notes || null,
            due,
            Date.now(),
            this.nextNum(),
            now,
            now,
            bump(),
            it.id,
            it.updated,
          )
          changed = true
          continue
        }
        if (t.gtask_dirty || t.deleted_at) continue // lokale Änderung gewinnt, wird gleich übertragen
        if (it.updated === t.gtask_updated) continue // eigene Änderung
        if (it.deleted) {
          // in Google gelöscht → Aufgabe bleibt in der App, verliert nur ihren Tag
          this.sql.exec(
            `UPDATE tasks SET gtask_id = NULL, gtask_updated = NULL, due_date = NULL, rollover_count = 0, updated_at = ?, seq = ? WHERE id = ?`,
            now,
            bump(),
            t.id,
          )
          changed = true
          continue
        }
        const title = (it.title ?? '').trim().slice(0, 500) || t.title
        const notes = it.notes || null
        if (title !== t.title || notes !== t.notes || due !== t.due_date) {
          this.sql.exec(
            `UPDATE tasks SET title = ?, notes = ?, due_date = ?, rollover_count = CASE WHEN ? IS NOT due_date THEN 0 ELSE rollover_count END,
               day_order = CASE WHEN ? IS NOT due_date THEN NULL ELSE day_order END,
               gtask_updated = ?, updated_at = ?, seq = ? WHERE id = ?`,
            title,
            notes,
            due,
            due,
            due,
            it.updated,
            now,
            bump(),
            t.id,
          )
          changed = true
        } else {
          this.sql.exec(`UPDATE tasks SET gtask_updated = ? WHERE id = ?`, it.updated, t.id)
        }
        const doneInGoogle = it.status === 'completed'
        if (doneInGoogle && t.status === 'open') complete.push({ id: t.id, updated: it.updated, recurring: !!t.rrule })
        if (!doneInGoogle && t.status === 'done') reopen.push({ id: t.id, updated: it.updated })
      }
      if (cursor !== since) this.sql.exec(`UPDATE google_account SET tasks_cursor = ? WHERE id = 1`, cursor)
    })

    // Abhaken/Öffnen wie in der App (wiederkehrende rücken vor, Unteraufgaben werden mit erledigt)
    for (const c of complete) {
      const kids = this.sql
        .exec<{ id: string }>(
          `WITH RECURSIVE sub(id) AS (SELECT id FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL
             UNION SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.deleted_at IS NULL)
           SELECT sub.id FROM sub JOIN tasks USING (id) WHERE tasks.status = 'open'`,
          c.id,
        )
        .toArray()
        .map((r) => r.id)
      this.bulkStatus({ ids: [c.id, ...(c.recurring ? [] : kids)], status: 'done', today })
      // nicht wiederkehrend: Google hat schon den richtigen Stand – nichts zurückschreiben
      if (!c.recurring) this.sql.exec(`UPDATE tasks SET gtask_dirty = 0, gtask_updated = ? WHERE id = ?`, c.updated, c.id)
      changed = true
    }
    for (const r of reopen) {
      this.bulkStatus({ ids: [r.id], status: 'open', today })
      this.sql.exec(`UPDATE tasks SET gtask_dirty = 0, gtask_updated = ? WHERE id = ?`, r.updated, r.id)
      changed = true
    }
    if (complete.some((c) => c.recurring)) this.queuePush()
    return changed
  }
}

// ---------------------------------------------------------------------------
type TaskFields = {
  list_id: string | null
  parent_id: string | null
  title: string
  notes: string | null
  status: 'open' | 'done'
  priority: number
  horizon: 'backlog' | 'short' | 'long'
  tags: string[]
  due_date: string | null
  start_at: string | null
  end_at: string | null
  timezone: string | null
  rrule: string | null
  sort: number
  completed_at: string | null
  origin_event_id: string | null
  deadline: string | null
  blocked_by: string[]
  estimate: number | null
  day_order: number | null
  part_index: number | null
}

const DEFAULT_TASK = (): Omit<TaskFields, 'title'> => ({
  list_id: null,
  parent_id: null,
  notes: null,
  status: 'open',
  priority: 0,
  horizon: 'backlog',
  tags: [],
  due_date: null,
  start_at: null,
  end_at: null,
  timezone: null,
  rrule: null,
  sort: Date.now(),
  completed_at: null,
  origin_event_id: null,
  deadline: null,
  blocked_by: [],
  estimate: null,
  day_order: null,
  part_index: null,
})

/** Anfrage einer alten App-Version: Wichtigkeit (auch in Vorlagen) auf die neue Skala heben */
function legacyBody(b: unknown): unknown {
  if (!b || typeof b !== 'object') return b
  const o = { ...(b as Record<string, unknown>) }
  if ('priority' in o) o.priority = upgradePrio(o.priority)
  if (o.payload && typeof o.payload === 'object') {
    const walk = (n: unknown): unknown => {
      if (!n || typeof n !== 'object') return n
      const c = { ...(n as Record<string, unknown>) }
      if ('priority' in c) c.priority = upgradePrio(c.priority)
      if (Array.isArray(c.subtasks)) c.subtasks = c.subtasks.map(walk)
      return c
    }
    o.payload = walk(o.payload)
  }
  return o
}

// ---------------------------------------------------------------------------
type TemplateRow = { id: string; name: string; payload: string; created_at: string; updated_at: string; deleted_at: string | null; seq: number }

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

function templateOut(r: TemplateRow) {
  return { id: r.id, name: r.name, payload: safeJson(r.payload), created_at: r.created_at, updated_at: r.updated_at }
}

interface TemplateNode {
  title: string
  notes?: string | null
  priority?: number
  tags?: string[]
  rrule?: string | null
  subtasks?: TemplateNode[]
}

/** Vorlage prüfen: Titel, optionale Felder, Unteraufgaben bis 3 Ebenen, höchstens 100 Einträge */
function cleanTemplatePayload(v: unknown): TemplateNode {
  let count = 0
  const walk = (n: unknown, depth: number): TemplateNode => {
    if (!n || typeof n !== 'object') throw new HttpError(400, 'Ungültige Vorlage')
    if (++count > 100) throw new HttpError(400, 'Vorlage zu groß')
    const o = n as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 500) : ''
    if (!title) throw new HttpError(400, 'Vorlage ohne Titel')
    const out: TemplateNode = { title }
    if (typeof o.notes === 'string' && o.notes.length <= 20000) out.notes = o.notes
    if (Number.isInteger(o.priority) && (o.priority as number) >= 0 && (o.priority as number) <= 5) out.priority = o.priority as number
    if (Array.isArray(o.tags)) out.tags = o.tags.filter((t): t is string => typeof t === 'string' && t.length <= 40).slice(0, 30)
    if (typeof o.rrule === 'string' && o.rrule.length <= 200) out.rrule = o.rrule
    if (Array.isArray(o.subtasks) && depth < 3) out.subtasks = o.subtasks.map((c) => walk(c, depth + 1))
    return out
  }
  return walk(v, 0)
}
