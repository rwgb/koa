import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'
import { type MemoryEntry, type NewMemoryEntry, GLOBAL_TYPES } from './schema.js'
import { getGlobalMemoryDb, getProjectMemoryDb } from './db.js'

const DEDUP_TYPES: ReadonlySet<string> = new Set(['assertion', 'standing-order'])

function resolveDb(entry: NewMemoryEntry, slug?: string): Database {
  return GLOBAL_TYPES.includes(entry.type)
    ? getGlobalMemoryDb()
    : getProjectMemoryDb(slug ?? 'default')
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  const entry: MemoryEntry = {
    id: row.id as string,
    type: row.type as MemoryEntry['type'],
    content: row.content as string,
    tags: JSON.parse(row.tags as string) as string[],
    created_at: row.created_at as string,
  }
  if (row.action_type != null) entry.action_type = row.action_type as 'notify' | 'brief' | 'agent'
  if (row.trigger_pattern != null) entry.trigger_pattern = row.trigger_pattern as string
  if (row.expires_at != null) entry.expires_at = row.expires_at as string
  return entry
}

export function writeMemoryEvent(entry: NewMemoryEntry, slug?: string): MemoryEntry
export function writeMemoryEvent(entry: NewMemoryEntry, slug?: string, db?: Database): MemoryEntry
export function writeMemoryEvent(entry: NewMemoryEntry, slug?: string, db?: Database): MemoryEntry {
  const resolvedDb = db ?? resolveDb(entry, slug)

  // Dedup only for assertion and standing-order types
  if (DEDUP_TYPES.has(entry.type)) {
    try {
      const hits = resolvedDb
        .prepare('SELECT entry_id FROM memory_fts WHERE content MATCH ?')
        .all(entry.content) as Array<{ entry_id: string }>

      for (const hit of hits) {
        const existing = resolvedDb
          .prepare('SELECT * FROM memory_entries WHERE id = ?')
          .get(hit.entry_id) as Record<string, unknown> | undefined

        if (
          existing &&
          (existing.content as string).toLowerCase().trim() === entry.content.toLowerCase().trim() &&
          existing.type === entry.type
        ) {
          // Bump created_at so this entry sorts as most-recent
          resolvedDb
            .prepare("UPDATE memory_entries SET created_at = datetime('now') WHERE id = ?")
            .run(existing.id)
          existing.created_at = new Date().toISOString()
          return rowToEntry(existing)
        }
      }
    } catch {
      // FTS query failed (e.g. special characters) — skip dedup, proceed with insert
    }
  }

  const id = randomUUID()

  resolvedDb
    .prepare(`
      INSERT INTO memory_entries (id, type, content, tags, action_type, trigger_pattern, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `)
    .run(
      id,
      entry.type,
      entry.content,
      JSON.stringify(entry.tags ?? []),
      entry.action_type ?? null,
      entry.trigger_pattern ?? null,
      entry.expires_at ?? null,
    )

  resolvedDb
    .prepare('INSERT INTO memory_fts(entry_id, content) VALUES (?, ?)')
    .run(id, entry.content)

  const saved = resolvedDb
    .prepare('SELECT * FROM memory_entries WHERE id = ?')
    .get(id) as Record<string, unknown>

  return rowToEntry(saved)
}
