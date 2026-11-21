import { DurableObject } from 'cloudflare:workers'
import { MIGRATIONS } from './migrations'
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
  type GCalendarListEntry,
  type GEvent,
  type GEventList,
  type GoogleConfig,
  type GoogleEnv,
} from './google'
import { daysBetween, nextOccurrence } from '../shared/recurrence'
import { moveBlockToDate } from '../shared/tz'

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
}

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

/** Nach jeder Änderung: muss der Google-Termin der Aufgabe angepasst werden? */
const MARK_DIRTY = `gcal_dirty = CASE WHEN start_at IS NOT NULL OR gcal_event_id IS NOT NULL THEN 1 ELSE gcal_dirty END`

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
    const times = ['cleanup_at', 'gpull_at', 'gpush_at'].map((k) => this.metaGet(k)).filter((v): v is number => v !== null)
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
      this.sql.exec(`UPDATE tasks SET parent_id = NULL WHERE (deleted_at IS NULL OR deleted_at >= ?1) AND parent_id IN (SELECT id FROM tasks WHERE deleted_at < ?1)`, cutoff)
      this.sql.exec(`UPDATE tasks SET list_id = NULL WHERE list_id IN (SELECT id FROM lists WHERE deleted_at < ?)`, cutoff)
      this.sql.exec(`DELETE FROM tasks WHERE deleted_at < ? AND gcal_dirty = 0`, cutoff)
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

    // Google
    if (pathname === '/api/google/status' && method === 'GET') return json(await this.googleStatus())
    if (pathname === '/api/google/connect' && method === 'GET') return this.googleConnect(url)
    if (pathname === '/api/google/events' && method === 'GET') return json(await this.googleEvents(url))
    if (pathname === '/api/google/disconnect' && method === 'POST') return json(await this.googleDisconnect())
    if (pathname === '/api/google/calendars' && method === 'POST') return json(this.googleSetCalendars(await readJson(req)))
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
    let res: Response | null = null

    if (pathname === '/api/rollover' && method === 'POST') res = json(this.rollover(await readJson(req)))
    else if (pathname === '/api/tasks' && method === 'POST') res = json(this.createTask(await readJson(req)), 201)
    else if (pathname === '/api/tasks/bulk' && method === 'POST') res = json(this.bulkStatus(await readJson(req)))
    else if (pathname === '/api/tasks/restore' && method === 'POST') res = json(this.restoreTasks(await readJson(req)))
    else if (tm && method === 'PATCH') res = json(this.updateTask(tm[1], await readJson(req)))
    else if (tm && method === 'DELETE') res = json(this.deleteTask(tm[1]))
    else if (pathname === '/api/lists' && method === 'POST') res = json(this.createList(await readJson(req)), 201)
    else if (lm && method === 'PATCH') res = json(this.updateList(lm[1], await readJson(req)))
    else if (lm && method === 'DELETE') res = json(this.deleteList(lm[1]))

    if (!res) throw new HttpError(404, 'Unbekannte Adresse')
    this.broadcast()
    this.queuePush()
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
    ]
    if (insert) {
      return this.sql
        .exec<TaskRow>(
          `INSERT INTO tasks (list_id, parent_id, title, notes, status, priority, horizon, tags, due_date, start_at, end_at,
             timezone, rrule, completed_at, sort, origin_event_id, id, created_at, updated_at, seq, gcal_event_id, gcal_etag, gcal_dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          ...values,
          id,
          now,
          now,
          seq,
          extra.gcal_event_id ?? null,
          extra.gcal_etag ?? null,
          extra.dirty === false ? 0 : t.start_at ? 1 : 0,
        )
        .one()
    }
    return this.sql
      .exec<TaskRow>(
        `UPDATE tasks SET list_id = ?, parent_id = ?, title = ?, notes = ?, status = ?, priority = ?, horizon = ?, tags = ?,
           due_date = ?, start_at = ?, end_at = ?, timezone = ?, rrule = ?, completed_at = ?, sort = ?, origin_event_id = ?,
           updated_at = ?, seq = ?, ${extra.dirty === false ? 'gcal_dirty = gcal_dirty' : MARK_DIRTY}
         WHERE id = ? RETURNING *`,
        ...values,
        now,
        seq,
        id,
      )
      .one()
  }

  private createTask(body: unknown) {
    const input = cleanTaskInput(body)
    if (!input.title) throw new HttpError(400, 'Titel fehlt')
    const id = input.id ?? crypto.randomUUID()
    const now = nowIso()
    const t = normalizeTask({ ...DEFAULT_TASK(), sort: Date.now(), ...input, title: input.title }, now)
    return this.tx(() => {
      this.checkRefs(id, t.list_id, t.parent_id)
      return taskOut(this.writeTask(id, t, now, true))
    })
  }

  private updateTask(id: string, body: unknown) {
    const patch = cleanTaskInput(body)
    delete patch.id
    return this.tx(() => {
      const cur = this.sql.exec<TaskRow>(`SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`, id).toArray()[0]
      if (!cur) throw new HttpError(404, 'Aufgabe nicht gefunden')
      if ('list_id' in patch || 'parent_id' in patch) this.checkRefs(id, patch.list_id, patch.parent_id)
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
                `UPDATE tasks SET due_date = ?, start_at = ?, end_at = ?, rollover_count = 0, status = 'open', completed_at = NULL,
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
             due_date = ?1, updated_at = ?2, seq = ?3
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
      this.sql.exec(`UPDATE google_account SET access_token = ?, access_expires_at = ?, status = 'ok' WHERE id = 1`, t.access_token, Date.now() + t.expires_in * 1000)
      return t.access_token
    } catch (e) {
      if (e instanceof GoogleApiError && (e.reason === 'invalid_grant' || e.status === 400 || e.status === 401)) {
        this.sql.exec(`UPDATE google_account SET status = 'reauth', access_token = NULL WHERE id = 1`)
        throw new HttpError(409, 'Die Verbindung zu Google ist abgelaufen – bitte neu verbinden.')
      }
      throw e
    }
  }

  private async g<T>(method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<T> {
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
    const base = { configured, connected: true, status: acc.status, email: acc.email }
    if (acc.status !== 'ok') return base
    try {
      const selected: string[] | null = acc.selected_calendars ? JSON.parse(acc.selected_calendars) : null
      const cals = (await this.calendars())
        .filter((c) => c.id !== acc.organizer_calendar_id)
        .map((c) => ({
          id: c.id,
          name: c.summaryOverride ?? c.summary,
          color: c.backgroundColor ?? '#5f6b7a',
          primary: !!c.primary,
          selected: selected ? selected.includes(c.id) : !!c.selected || !!c.primary,
        }))
        .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name))
      return { ...base, calendars: cals }
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) return { ...base, status: 'reauth' }
      throw e
    }
  }

  private async googleConnect(url: URL): Promise<Response> {
    const cfg = this.cfg()
    if (!cfg) return redirect('/?google=not-configured')
    const { verifier, challenge } = await pkcePair()
    const state = randomState()
    const redirectUri = `${url.origin}/api/google/callback`
    this.sql.exec(`DELETE FROM oauth_states WHERE created_at < ?`, Date.now() - 15 * MIN)
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
    if (!row || Date.now() - row.created_at > 15 * MIN || !code) return redirect('/?google=error&reason=state')

    try {
      const t = await exchangeCode(cfg, code, row.verifier, row.redirect_uri)
      const existing = this.account()
      const refresh = t.refresh_token ?? existing?.refresh_token
      if (!refresh) return redirect('/?google=error&reason=no_refresh_token')
      this.sql.exec(
        `INSERT INTO google_account (id, refresh_token, access_token, access_expires_at, status, connected_at)
         VALUES (1, ?, ?, ?, 'ok', ?)
         ON CONFLICT (id) DO UPDATE SET refresh_token = excluded.refresh_token, access_token = excluded.access_token,
           access_expires_at = excluded.access_expires_at, status = 'ok'`,
        refresh,
        t.access_token,
        Date.now() + t.expires_in * 1000,
        nowIso(),
      )
      this.calendarCache = null
      this.eventCache.clear()
      const cals = await this.calendars(true)
      const primary = cals.find((c) => c.primary)
      let organizer = cals.find((c) => c.description?.includes(ORGANIZER_CALENDAR_MARK) && c.accessRole === 'owner')
      if (!organizer) {
        const created = await this.g<{ id: string }>('POST', '/calendars', {
          body: {
            summary: ORGANIZER_CALENDAR_NAME,
            description: `Aufgaben mit Uhrzeit aus deinem Organizer. (${ORGANIZER_CALENDAR_MARK})`,
            timeZone: url.searchParams.get('tz') ?? 'Europe/Berlin',
          },
        })
        organizer = { id: created.id, summary: ORGANIZER_CALENDAR_NAME, accessRole: 'owner' }
        this.calendarCache = null
      }
      this.sql.exec(`UPDATE google_account SET email = ?, organizer_calendar_id = ?, sync_token = NULL WHERE id = 1`, primary?.id ?? null, organizer.id)
      // alle geplanten Aufgaben einmal übertragen
      this.sql.exec(`UPDATE tasks SET gcal_dirty = 1 WHERE deleted_at IS NULL AND start_at IS NOT NULL`)
      this.metaSet('gpull_at', Date.now() + 5000)
      this.metaSet('gpush_at', Date.now() + 1000)
      await this.scheduleAlarm()
      return redirect('/?google=connected')
    } catch (e) {
      console.error('google callback', e)
      const reason = e instanceof GoogleApiError ? e.reason ?? String(e.status) : 'unknown'
      return redirect(`/?google=error&reason=${encodeURIComponent(reason)}`)
    }
  }

  private async googleDisconnect() {
    const cfg = this.cfg()
    const acc = this.account()
    if (cfg && acc) await revokeToken(cfg, acc.refresh_token)
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM google_account`)
      this.sql.exec(`UPDATE tasks SET gcal_event_id = NULL, gcal_etag = NULL, gcal_dirty = 0`)
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
    if (!isDate(from) || !isDate(to) || daysBetween(from, to) < 0 || daysBetween(from, to) > 62) throw new HttpError(400, 'Ungültiger Zeitraum')
    const acc = this.account()
    if (!acc || !this.cfg() || acc.status !== 'ok') return { events: [] }
    const key = `${from}|${to}`
    const hit = this.eventCache.get(key)
    if (hit && Date.now() - hit.at < 90_000) return { events: hit.data }

    const selected: string[] | null = acc.selected_calendars ? JSON.parse(acc.selected_calendars) : null
    const cals = (await this.calendars()).filter((c) => c.id !== acc.organizer_calendar_id && (selected ? selected.includes(c.id) : c.selected || c.primary))
    // großzügig einen Tag davor/danach holen, die App filtert nach Ortszeit
    const timeMin = new Date(Date.parse(from) - DAY).toISOString()
    const timeMax = new Date(Date.parse(to) + 2 * DAY).toISOString()
    const lists = await Promise.all(
      cals.map((c) =>
        this.g<GEventList>('GET', `/calendars/${encodeURIComponent(c.id)}/events`, {
          query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' },
        })
          .then((r) => ({ c, items: r.items ?? [] }))
          .catch((e) => {
            console.warn('events', c.id, e)
            return { c, items: [] as GEvent[] }
          }),
      ),
    )
    const events: CalendarEventOut[] = []
    for (const { c, items } of lists) {
      for (const e of items) {
        if (e.status === 'cancelled' || !e.start || !e.end) continue
        const allDay = !!e.start.date
        events.push({
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
        })
      }
    }
    this.eventCache.set(key, { at: Date.now(), data: events })
    if (this.eventCache.size > 20) this.eventCache.delete(this.eventCache.keys().next().value!)
    return { events }
  }

  // -------------------------------------------------------------------------
  // Google Kalender – Aufgaben mit Uhrzeit hinschreiben
  // -------------------------------------------------------------------------
  private queuePush() {
    const acc = this.account()
    if (!acc || acc.status !== 'ok' || !acc.organizer_calendar_id) return
    if (!this.sql.exec(`SELECT 1 FROM tasks WHERE gcal_dirty = 1 LIMIT 1`).toArray().length) return
    this.ctx.waitUntil(this.pushGoogle())
  }

  private pushGoogle(): Promise<void> {
    this.pushing ??= this.doPush().finally(() => {
      this.pushing = null
    })
    return this.pushing
  }

  private async doPush() {
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
              summary: (t.status === 'done' ? '✓ ' : '') + t.title,
              description: [t.notes, 'Aus deinem Organizer'].filter(Boolean).join('\n\n'),
              start: { dateTime: t.start_at, timeZone: t.timezone ?? 'UTC' },
              end: { dateTime: t.end_at, timeZone: t.timezone ?? 'UTC' },
              extendedProperties: { private: { organizerTaskId: t.id } },
              // Erinnerung aufs Handy 10 Minuten vorher (über die Google-Kalender-App), erledigte ohne
              reminders: { useDefault: false, overrides: t.status === 'done' ? [] : [{ method: 'popup', minutes: 10 }] },
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
    if (!acc || acc.status !== 'ok' || !acc.organizer_calendar_id || !this.cfg()) return false
    this.lastPull = Date.now()
    if (this.pushing) await this.pushing
    const cal = encodeURIComponent(acc.organizer_calendar_id)
    const items: GEvent[] = []
    let syncToken = acc.sync_token
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
        syncToken = null
        return this.doPull()
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
            `INSERT INTO tasks (id, title, notes, status, priority, horizon, tags, due_date, start_at, end_at, timezone, sort,
               created_at, updated_at, seq, gcal_event_id, gcal_etag, gcal_dirty, origin_event_id)
             VALUES (?, ?, ?, 'open', 4, 'backlog', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
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
    if (this.metaGet('gpull_at') === null) {
      this.metaSet('gpull_at', Date.now() + PULL_EVERY)
      await this.scheduleAlarm()
    }
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
}

const DEFAULT_TASK = (): Omit<TaskFields, 'title'> => ({
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
  sort: Date.now(),
  completed_at: null,
  origin_event_id: null,
})
