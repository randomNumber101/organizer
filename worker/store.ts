import { DurableObject } from 'cloudflare:workers'
import { MIGRATIONS } from './migrations'
import { login, logout, requireSession } from './auth'
import { HttpError, cleanListInput, cleanTaskInput, isDate, isUuid, listOut, normalizeTask, taskOut, type ListRow, type TaskRow } from './db'

export interface Env {
  STORE: DurableObjectNamespace<OrganizerStore>
  ASSETS: Fetcher
  APP_PASSWORD?: string
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const nowIso = () => new Date().toISOString()
const DAY = 86_400_000

const TASK_PATH = /^\/api\/tasks\/([0-9a-f-]{36})$/i
const LIST_PATH = /^\/api\/lists\/([0-9a-f-]{36})$/i

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

/**
 * Die ganze Datenhaltung der App in einem einzigen Durable Object:
 * SQLite-Datenbank, Anmeldung, und die WebSocket-Verbindungen für den Live-Sync.
 * Alles läuft nacheinander in einem Objekt – dadurch sind Änderungen automatisch konsistent.
 */
export class OrganizerStore extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    // Herzschlag beantworten, ohne das Objekt aufzuwecken
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    ctx.blockConcurrencyWhile(async () => {
      this.migrate()
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + DAY)
    })
  }

  // -------------------------------------------------------------------------
  // Schema
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
  // HTTP
  // -------------------------------------------------------------------------
  async fetch(req: Request): Promise<Response> {
    try {
      const res = await this.route(req)
      return res
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status)
      console.error(e)
      return json({ error: 'Interner Fehler' }, 500)
    }
  }

  private async route(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url
    const method = req.method

    if (pathname === '/api/login' && method === 'POST') return login(req, this.sql, this.env.APP_PASSWORD)

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
    if (pathname === '/api/sync' && method === 'GET') return json(this.sync(url))

    // ab hier nur Änderungen
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
  // Nächtliches Aufräumen (Alarm statt Cron – kostet nichts extra)
  // -------------------------------------------------------------------------
  async alarm() {
    const now = Date.now()
    const cutoff = new Date(now - 30 * DAY).toISOString()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM sessions WHERE expires_at < ?`, new Date(now).toISOString())
      this.sql.exec(`DELETE FROM login_attempts WHERE ts < ?`, now - DAY)
      this.sql.exec(`UPDATE tasks SET parent_id = NULL WHERE (deleted_at IS NULL OR deleted_at >= ?1) AND parent_id IN (SELECT id FROM tasks WHERE deleted_at < ?1)`, cutoff)
      this.sql.exec(`UPDATE tasks SET list_id = NULL WHERE list_id IN (SELECT id FROM lists WHERE deleted_at < ?)`, cutoff)
      this.sql.exec(`DELETE FROM tasks WHERE deleted_at < ?`, cutoff)
      this.sql.exec(`DELETE FROM lists WHERE deleted_at < ?`, cutoff)
    })
    await this.ctx.storage.setAlarm(now + DAY)
  }

  // -------------------------------------------------------------------------
  // Daten
  // -------------------------------------------------------------------------
  private sync(url: URL) {
    const since = Number(url.searchParams.get('since') ?? '0')
    if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'Ungültiger Stand')
    const cursor = this.sql.exec<{ value: number }>(`SELECT value FROM meta WHERE key = 'seq'`).one().value
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

  private createTask(body: unknown) {
    const input = cleanTaskInput(body)
    if (!input.title) throw new HttpError(400, 'Titel fehlt')
    const id = input.id ?? crypto.randomUUID()
    const now = nowIso()
    const t = normalizeTask(
      {
        list_id: null as string | null,
        parent_id: null as string | null,
        notes: null as string | null,
        status: 'open' as 'open' | 'done',
        priority: 4,
        horizon: 'backlog' as 'backlog' | 'short' | 'long',
        tags: [] as string[],
        due_date: null as string | null,
        start_at: null as string | null,
        end_at: null as string | null,
        timezone: null as string | null,
        rrule: null as string | null,
        sort: Date.now(),
        completed_at: null as string | null,
        ...input,
        title: input.title,
      },
      now,
    )
    return this.tx(() => {
      this.checkRefs(id, t.list_id, t.parent_id)
      const seq = this.nextSeq()
      const row = this.sql
        .exec<TaskRow>(
          `INSERT INTO tasks (id, list_id, parent_id, title, notes, status, priority, horizon, tags, due_date, start_at, end_at,
             timezone, rrule, completed_at, sort, created_at, updated_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          id,
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
          now,
          now,
          seq,
        )
        .one()
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
      const now = nowIso()
      const t = normalizeTask({ ...taskOut(cur), ...patch }, now)
      const seq = this.nextSeq()
      const row = this.sql
        .exec<TaskRow>(
          `UPDATE tasks SET list_id = ?, parent_id = ?, title = ?, notes = ?, status = ?, priority = ?, horizon = ?, tags = ?,
             due_date = ?, start_at = ?, end_at = ?, timezone = ?, rrule = ?, completed_at = ?, sort = ?, updated_at = ?, seq = ?
           WHERE id = ? RETURNING *`,
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
          now,
          seq,
          id,
        )
        .one()
      return taskOut(row)
    })
  }

  private bulkStatus(body: unknown) {
    const b = (body ?? {}) as { ids?: unknown; status?: unknown }
    const ids = idList(b.ids)
    if (b.status !== 'open' && b.status !== 'done') throw new HttpError(400, 'Ungültiger Status')
    const status = b.status
    return this.tx(() => {
      const now = nowIso()
      const seq = this.nextSeq()
      const rows = this.sql
        .exec<TaskRow>(
          `UPDATE tasks SET status = ?1,
             completed_at = CASE WHEN ?1 = 'done' THEN COALESCE(completed_at, ?2) ELSE NULL END,
             updated_at = ?2, seq = ?3
           WHERE id IN (SELECT value FROM json_each(?4)) AND deleted_at IS NULL RETURNING *`,
          status,
          now,
          seq,
          JSON.stringify(ids),
        )
        .toArray()
      return { tasks: rows.map(taskOut) }
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
           UPDATE tasks SET deleted_at = ?2, updated_at = ?2, seq = ?3 WHERE id IN (SELECT id FROM sub) RETURNING id`,
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
          `UPDATE tasks SET deleted_at = NULL, updated_at = ?1, seq = ?2,
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
}
