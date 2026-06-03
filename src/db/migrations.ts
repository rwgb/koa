import type Database from 'better-sqlite3';

// Each migration: [version, sql]
const MIGRATIONS: [number, string][] = [
  [
    1,
    `
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      slug        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects(id),
      title        TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'todo',
      priority     INTEGER NOT NULL DEFAULT 3,
      deadline     TEXT,
      effort_hours REAL,
      tags         TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id       TEXT NOT NULL REFERENCES tasks(id),
      depends_on_id TEXT NOT NULL REFERENCES tasks(id),
      PRIMARY KEY (task_id, depends_on_id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      action      TEXT NOT NULL,
      payload     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title      TEXT NOT NULL,
      context    TEXT NOT NULL DEFAULT '',
      options    TEXT NOT NULL DEFAULT '[]',
      chosen     TEXT NOT NULL DEFAULT '',
      rationale  TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label      TEXT NOT NULL,
      notes      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Standalone FTS5 (not content=) so the index is self-contained and
    -- doesn't require the DB to be kept open between writes to stay consistent.
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
      task_id UNINDEXED,
      title, description, tags
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline   ON tasks(deadline);
    CREATE INDEX IF NOT EXISTS idx_audit_entity     ON audit_log(entity_type, entity_id);
    `,
  ],
  [
    2,
    `
    -- Replace content= FTS5 table with a standalone one.
    -- The content= approach requires the DB to remain open between writes;
    -- the standalone table is self-contained and avoids "disk image is malformed" errors.
    DROP TABLE IF EXISTS tasks_fts;
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
      task_id UNINDEXED,
      title, description, tags
    );
    -- Re-index any existing tasks
    INSERT INTO tasks_fts(task_id, title, description, tags)
    SELECT id, title, description, tags FROM tasks;
    `,
  ],
  [
    3,
    `
    CREATE TABLE IF NOT EXISTS processed_messages (
      id           TEXT PRIMARY KEY,
      channel      TEXT NOT NULL,
      external_id  TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      intent       TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pm_channel_external
      ON processed_messages(channel, external_id);
    `,
  ],
  [
    4,
    `
    CREATE TABLE IF NOT EXISTS calendar_events (
      id            TEXT PRIMARY KEY,
      google_id     TEXT NOT NULL UNIQUE,
      title         TEXT NOT NULL,
      start_at      TEXT NOT NULL,
      end_at        TEXT NOT NULL,
      all_day       INTEGER NOT NULL DEFAULT 0,
      location      TEXT,
      description   TEXT,
      attendees     TEXT NOT NULL DEFAULT '[]',
      recurrence    TEXT,
      synced_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_cal_end   ON calendar_events(end_at);
    `,
  ],
  [
    5,
    `
    CREATE TABLE IF NOT EXISTS notification_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id           TEXT NOT NULL,
      escalation_level  TEXT NOT NULL,
      channel           TEXT NOT NULL,
      sent_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notif_log_task
      ON notification_log(task_id, escalation_level, sent_at DESC);
    `,
  ],
  [
    6,
    `
    ALTER TABLE tasks ADD COLUMN actual_hours REAL;
    `,
  ],
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
    INSERT INTO schema_version (version)
    SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
  `);

  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
  let currentVersion = row.version;

  for (const [version, sql] of MIGRATIONS) {
    if (version <= currentVersion) continue;

    // Run each migration inside a transaction for atomicity
    db.transaction(() => {
      db.exec(sql);
      db.prepare('UPDATE schema_version SET version = ?').run(version);
    })();

    currentVersion = version;
    process.stderr.write(`[koa/db] applied migration ${version}\n`);
  }
}
