/**
 * Datenbankschema (SQLite im Durable Object). Das Objekt spielt fehlende Migrationen beim Start selbst ein,
 * dadurch braucht das Deployment keine extra Datenbank oder Rechte.
 *
 * Regeln: Migrationen nie nachträglich ändern, nur neue anhängen (fortlaufende id).
 */
export interface Migration {
  id: number
  name: string
  statements: string[]
  /** optional: Umbauten, die sich nicht in reinem SQL ausdrücken lassen (läuft nach den statements, in derselben Transaktion) */
  run?: (sql: SqlStorage) => void
}

/** alte Wichtigkeit (1 hoch … 4 ohne) → neue Skala 0–5 (5 = dringend, 0 = ohne) */
export const upgradePrio = (p: unknown): number => (p === 1 ? 4 : p === 2 ? 3 : p === 3 ? 2 : 0)

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    statements: [
      // Zähler für die Synchronisation: jede Änderung bekommt eine fortlaufende Nummer (seq)
      `CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
      `INSERT INTO meta (key, value) VALUES ('seq', 0)`,

      `CREATE TABLE lists (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        color       TEXT NOT NULL DEFAULT '#2f5d50',
        sort        REAL NOT NULL DEFAULT 0,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT,
        seq         INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX lists_seq_idx ON lists (seq)`,

      `CREATE TABLE tasks (
        id              TEXT PRIMARY KEY,
        list_id         TEXT REFERENCES lists (id),
        parent_id       TEXT REFERENCES tasks (id),
        title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
        notes           TEXT CHECK (notes IS NULL OR length(notes) <= 20000),
        status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
        priority        INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
        horizon         TEXT NOT NULL DEFAULT 'backlog' CHECK (horizon IN ('backlog', 'short', 'long')),
        tags            TEXT NOT NULL DEFAULT '[]',
        due_date        TEXT,
        start_at        TEXT,
        end_at          TEXT,
        timezone        TEXT,
        rrule           TEXT,
        rollover_count  INTEGER NOT NULL DEFAULT 0,
        completed_at    TEXT,
        sort            REAL NOT NULL DEFAULT 0,
        gcal_event_id   TEXT,
        gcal_etag       TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT,
        seq             INTEGER NOT NULL DEFAULT 0,
        CHECK ((start_at IS NULL AND end_at IS NULL) OR (start_at IS NOT NULL AND end_at IS NOT NULL AND timezone IS NOT NULL))
      )`,
      `CREATE INDEX tasks_seq_idx ON tasks (seq)`,
      `CREATE INDEX tasks_parent_idx ON tasks (parent_id)`,
      `CREATE INDEX tasks_list_idx ON tasks (list_id)`,
      `CREATE INDEX tasks_open_due_idx ON tasks (status, due_date) WHERE deleted_at IS NULL`,

      `CREATE TABLE sessions (
        token_hash  TEXT PRIMARY KEY,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        last_seen   TEXT NOT NULL,
        user_agent  TEXT
      )`,

      `CREATE TABLE login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
      `CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, ts)`,
    ],
  },
  {
    id: 2,
    name: 'google_calendar',
    statements: [
      // Aufgabe stammt aus einem Google-Termin (zum Wiedererkennen)
      `ALTER TABLE tasks ADD COLUMN origin_event_id TEXT`,
      // 1 = muss noch zum Google-Kalender übertragen werden
      `ALTER TABLE tasks ADD COLUMN gcal_dirty INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX tasks_gcal_dirty_idx ON tasks (gcal_dirty) WHERE gcal_dirty = 1`,
      `CREATE INDEX tasks_gcal_event_idx ON tasks (gcal_event_id)`,

      `CREATE TABLE google_account (
        id                     INTEGER PRIMARY KEY CHECK (id = 1),
        email                  TEXT,
        refresh_token          TEXT NOT NULL,
        access_token           TEXT,
        access_expires_at      INTEGER,
        organizer_calendar_id  TEXT,
        selected_calendars     TEXT,
        sync_token             TEXT,
        status                 TEXT NOT NULL DEFAULT 'ok',
        connected_at           TEXT NOT NULL
      )`,

      `CREATE TABLE oauth_states (
        state         TEXT PRIMARY KEY,
        verifier      TEXT NOT NULL,
        redirect_uri  TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      )`,
    ],
  },
  {
    id: 3,
    name: 'deadlines_blocking_templates_push',
    statements: [
      // Frist (getrennt vom Tag, an dem man die Aufgabe erledigen will)
      `ALTER TABLE tasks ADD COLUMN deadline TEXT`,
      // Aufgabe wartet auf andere Aufgaben (JSON-Liste von ids)
      `ALTER TABLE tasks ADD COLUMN blocked_by TEXT NOT NULL DEFAULT '[]'`,

      `CREATE TABLE templates (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT,
        seq         INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX templates_seq_idx ON templates (seq)`,

      // Einstellungen, die zwischen Geräten synchronisiert werden (Ansichten, Benachrichtigungen …)
      `CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0)`,
      // Interne Werte (z. B. Schlüssel für Push)
      `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

      `CREATE TABLE push_subscriptions (
        endpoint    TEXT PRIMARY KEY,
        timezone    TEXT NOT NULL,
        user_agent  TEXT,
        created_at  TEXT NOT NULL,
        last_ok     TEXT
      )`,
      `CREATE TABLE notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT, tag TEXT, created_at INTEGER NOT NULL)`,
      `CREATE TABLE reminders_sent (key TEXT PRIMARY KEY, sent_at INTEGER NOT NULL)`,
      `CREATE TABLE op_log (op_id TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    ],
  },
  {
    id: 4,
    name: 'task_numbers_estimate',
    statements: [
      // kurze Nummer pro Aufgabe („warte auf 4“) und geschätzte Dauer in Minuten
      `ALTER TABLE tasks ADD COLUMN num INTEGER`,
      `ALTER TABLE tasks ADD COLUMN estimate INTEGER`,
      `UPDATE tasks SET num = (SELECT COUNT(*) FROM tasks t2 WHERE t2.created_at < tasks.created_at OR (t2.created_at = tasks.created_at AND t2.id <= tasks.id))`,
      `CREATE UNIQUE INDEX tasks_num_idx ON tasks (num)`,
      `INSERT OR REPLACE INTO meta (key, value) SELECT 'next_num', COALESCE(MAX(num), 0) + 1 FROM tasks`,
      // damit alle Geräte die Nummern auch beim kleinen Abgleich bekommen
      `UPDATE meta SET value = value + 1 WHERE key = 'seq'`,
      `UPDATE tasks SET seq = (SELECT value FROM meta WHERE key = 'seq') WHERE deleted_at IS NULL`,
    ],
  },
  {
    id: 5,
    name: 'google_tasks',
    statements: [
      // Aufgaben mit Tag (ohne Uhrzeit) als Google Aufgaben in der Liste „Organizer“
      `ALTER TABLE tasks ADD COLUMN gtask_id TEXT`,
      `ALTER TABLE tasks ADD COLUMN gtask_updated TEXT`,
      `ALTER TABLE tasks ADD COLUMN gtask_dirty INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX tasks_gtask_dirty_idx ON tasks (gtask_dirty) WHERE gtask_dirty = 1`,
      `CREATE INDEX tasks_gtask_idx ON tasks (gtask_id)`,
      `ALTER TABLE google_account ADD COLUMN scopes TEXT`,
      `ALTER TABLE google_account ADD COLUMN tasks_list_id TEXT`,
      // NULL = noch nicht entschieden (wird beim ersten Mal mit Berechtigung eingeschaltet), 0 = aus, 1 = an
      `ALTER TABLE google_account ADD COLUMN tasks_enabled INTEGER`,
      `ALTER TABLE google_account ADD COLUMN tasks_cursor TEXT`,
      `ALTER TABLE google_account ADD COLUMN tasks_problem TEXT`,
    ],
  },
  {
    id: 6,
    name: 'day_order',
    statements: [
      // Reihenfolge innerhalb des Tages, an dem die Aufgabe dran ist („Heute“, „Tag planen“)
      `ALTER TABLE tasks ADD COLUMN day_order REAL`,
    ],
  },
  {
    id: 7,
    name: 'prio_0_5_and_parts',
    statements: [
      // Wichtigkeit 0–5 (5 = dringend, 0 = ohne). Neue Spalte, weil die alte per CHECK auf 1–4 festgelegt ist.
      `ALTER TABLE tasks ADD COLUMN prio INTEGER NOT NULL DEFAULT 0`,
      `UPDATE tasks SET prio = CASE priority WHEN 1 THEN 4 WHEN 2 THEN 3 WHEN 3 THEN 2 ELSE 0 END`,
      // Teil einer aufgeteilten Aufgabe (1, 2, 3 … unter der Hauptaufgabe); NULL = normale Aufgabe
      `ALTER TABLE tasks ADD COLUMN part_index INTEGER`,
      // alle Geräte holen sich die umgerechneten Werte beim nächsten Abgleich
      `UPDATE meta SET value = value + 1 WHERE key = 'seq'`,
      `UPDATE tasks SET seq = (SELECT value FROM meta WHERE key = 'seq')`,
      `UPDATE templates SET seq = (SELECT value FROM meta WHERE key = 'seq')`,
      `UPDATE prefs SET seq = (SELECT value FROM meta WHERE key = 'seq') WHERE key = 'views'`,
    ],
    run: (sql) => {
      type Node = { priority?: unknown; subtasks?: Node[] }
      const walk = (n: Node) => {
        if (n && typeof n === 'object') {
          if ('priority' in n) n.priority = upgradePrio(n.priority)
          if (Array.isArray(n.subtasks)) n.subtasks.forEach(walk)
        }
      }
      for (const r of sql.exec<{ id: string; payload: string }>(`SELECT id, payload FROM templates`).toArray()) {
        try {
          const p = JSON.parse(r.payload) as Node
          walk(p)
          sql.exec(`UPDATE templates SET payload = ? WHERE id = ?`, JSON.stringify(p), r.id)
        } catch {
          /* kaputte Vorlage bleibt, wie sie ist */
        }
      }
      for (const r of sql.exec<{ value: string }>(`SELECT value FROM prefs WHERE key = 'views'`).toArray()) {
        try {
          const views = JSON.parse(r.value) as { filter?: { priorities?: unknown[] } }[]
          if (!Array.isArray(views)) continue
          for (const v of views) if (Array.isArray(v?.filter?.priorities)) v.filter!.priorities = [...new Set(v.filter!.priorities.map(upgradePrio))]
          sql.exec(`UPDATE prefs SET value = ? WHERE key = 'views'`, JSON.stringify(views))
        } catch {
          /* egal */
        }
      }
    },
  },
]
