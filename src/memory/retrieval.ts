import type Database from 'better-sqlite3'
import type { MemoryEntry } from './schema.js'
import { getGlobalMemoryDb, getProjectMemoryDb } from './db.js'

type RankedEntry = MemoryEntry & { _rank: number }

function escapeQuery(query: string): string {
  return query.replace(/['"*:^~()]/g, ' ').trim()
}

export function queryDb(query: string, db: Database.Database, limit = 10): RankedEntry[] {
  const escaped = escapeQuery(query)
  if (!escaped) return []

  try {
    const rows = db
      .prepare(`
        SELECT me.id, me.type, me.content, me.tags, me.action_type, me.trigger_pattern, me.created_at, me.expires_at
        FROM memory_fts
        JOIN memory_entries me ON memory_fts.entry_id = me.id
        WHERE memory_fts MATCH ?
          AND (me.expires_at IS NULL OR me.expires_at > datetime('now'))
        ORDER BY bm25(memory_fts)
        LIMIT ?
      `)
      .all(escaped, limit) as Array<Record<string, unknown>>

    return rows.map((row, index) => {
      const entry: RankedEntry = {
        id: row.id as string,
        type: row.type as MemoryEntry['type'],
        content: row.content as string,
        tags: JSON.parse(row.tags as string) as string[],
        created_at: row.created_at as string,
        _rank: index,
      }
      if (row.action_type != null) entry.action_type = row.action_type as NonNullable<MemoryEntry['action_type']>
      if (row.trigger_pattern != null) entry.trigger_pattern = row.trigger_pattern as string
      if (row.expires_at != null) entry.expires_at = row.expires_at as string
      return entry
    })
  } catch {
    return []
  }
}

export function rrfMerge(listA: RankedEntry[], listB: RankedEntry[], k = 60): MemoryEntry[] {
  const scores = new Map<string, number>()
  const entries = new Map<string, MemoryEntry>()

  for (const item of listA) {
    scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + item._rank))
    entries.set(item.id, item)
  }
  for (const item of listB) {
    scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + item._rank))
    if (!entries.has(item.id)) entries.set(item.id, item)
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => entries.get(id)!)
}

export function queryMemories(query: string, slug?: string, limit = 10): MemoryEntry[] {
  const globalResults = queryDb(query, getGlobalMemoryDb(), limit)

  if (!slug) {
    return globalResults.map(({ _rank: _, ...entry }) => entry)
  }

  const projectResults = queryDb(query, getProjectMemoryDb(slug), limit)
  return rrfMerge(globalResults, projectResults, 60).slice(0, limit)
}

export function buildEpisodicMemoryInjection(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map(e => `- [${e.type}] ${e.content}`)
  return `<episodic_memories>\n${lines.join('\n')}\n</episodic_memories>`
}
