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
}

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
]
