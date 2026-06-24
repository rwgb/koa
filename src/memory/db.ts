import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

// Singleton cache: resolved path → open DB instance
const dbCache = new Map<string, Database.Database>()

/**
 * Clears the module-level DB cache and closes all open handles.
 * Intended for test teardown only — do not call in production code.
 */
export function clearDbCache(): void {
  for (const db of dbCache.values()) {
    try { db.close() } catch { /* already closed */ }
  }
  dbCache.clear()
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      action_type TEXT,
      trigger_pattern TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_me_type ON memory_entries(type);
    CREATE INDEX IF NOT EXISTS idx_me_created ON memory_entries(created_at DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      entry_id UNINDEXED,
      content
    );
  `)
}

function openDb(resolvedPath: string): Database.Database {
  if (dbCache.has(resolvedPath)) {
    return dbCache.get(resolvedPath)!
  }
  mkdirSync(dirname(resolvedPath), { recursive: true })
  const db = new Database(resolvedPath)
  initSchema(db)
  dbCache.set(resolvedPath, db)
  return db
}

export function getGlobalMemoryDb(overridePath?: string): Database.Database {
  const resolvedPath = overridePath ?? join(homedir(), '.koa', 'memory.db')
  return openDb(resolvedPath)
}

export function getProjectMemoryDb(slug: string, overridePath?: string): Database.Database {
  const resolvedPath = overridePath ?? join(homedir(), '.koa', 'projects', slug, 'memory.db')
  return openDb(resolvedPath)
}
