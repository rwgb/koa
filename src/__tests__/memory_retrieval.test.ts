import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { initSchema } from '../memory/db.js'
import { queryDb, rrfMerge, buildEpisodicMemoryInjection } from '../memory/retrieval.js'
import type { MemoryEntry } from '../memory/schema.js'

// ---------------------------------------------------------------------------
// Test infrastructure — temp DB factory
// ---------------------------------------------------------------------------

const openDbs: Database.Database[] = []
const tempPaths: string[] = []

afterEach(() => {
  for (const db of openDbs) {
    try { db.close() } catch { /* already closed */ }
  }
  openDbs.length = 0
  for (const p of tempPaths) {
    try { unlinkSync(p) } catch { /* already gone */ }
  }
  tempPaths.length = 0
})

function makeTempDb(): Database.Database {
  const p = join(
    tmpdir(),
    `koa-retrieval-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  tempPaths.push(p)
  const db = new BetterSqlite3(p)
  initSchema(db)
  openDbs.push(db)
  return db
}

function insertEntry(db: Database.Database, overrides: Partial<MemoryEntry> & { content: string }): string {
  const id = overrides.id ?? randomUUID()
  db.prepare(`
    INSERT INTO memory_entries (id, type, content, tags, action_type, trigger_pattern, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    id,
    overrides.type ?? 'assertion',
    overrides.content,
    JSON.stringify(overrides.tags ?? []),
    overrides.action_type ?? null,
    overrides.trigger_pattern ?? null,
    overrides.expires_at ?? null,
  )
  db.prepare('INSERT INTO memory_fts(entry_id, content) VALUES (?, ?)').run(id, overrides.content)
  return id
}

// ---------------------------------------------------------------------------
// 1. Empty query returns []
// ---------------------------------------------------------------------------

describe('queryDb — empty query', () => {
  it('returns [] for empty string', () => {
    const db = makeTempDb()
    insertEntry(db, { content: 'some content here' })
    expect(queryDb('', db)).toEqual([])
  })

  it('returns [] for query with only special chars', () => {
    const db = makeTempDb()
    insertEntry(db, { content: 'some content here' })
    expect(queryDb('*:^~', db)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Returns entry matching BM25 query
// ---------------------------------------------------------------------------

describe('queryDb — BM25 match', () => {
  it('returns the matching entry and not the unrelated one', () => {
    const db = makeTempDb()
    insertEntry(db, { content: 'typescript is statically typed' })
    insertEntry(db, { content: 'use dark mode for the terminal' })

    const results = queryDb('typescript', db)
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toBe('typescript is statically typed')
  })
})

// ---------------------------------------------------------------------------
// 3. Expiry: expired entry is excluded
// ---------------------------------------------------------------------------

describe('queryDb — expiry', () => {
  it('excludes an entry with expires_at in the past', () => {
    const db = makeTempDb()
    insertEntry(db, {
      content: 'expired preference setting',
      expires_at: '2000-01-01T00:00:00.000Z',
    })

    const results = queryDb('expired preference', db)
    expect(results).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 4. Expiry: non-expired entry is included
  // ---------------------------------------------------------------------------

  it('includes an entry with expires_at far in the future', () => {
    const db = makeTempDb()
    insertEntry(db, {
      content: 'future preference setting',
      expires_at: '2099-12-31T23:59:59.000Z',
    })

    const results = queryDb('future preference', db)
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toBe('future preference setting')
  })
})

// ---------------------------------------------------------------------------
// 5. rrfMerge: deduplicates entries appearing in both lists
// ---------------------------------------------------------------------------

describe('rrfMerge — deduplication', () => {
  it('deduplicates entries with the same id from both lists', () => {
    const entry: MemoryEntry & { _rank: number } = {
      id: 'abc',
      type: 'assertion',
      content: 'shared content',
      tags: [],
      created_at: new Date().toISOString(),
      _rank: 0,
    }

    const result = rrfMerge([entry], [entry])
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('abc')
  })
})

// ---------------------------------------------------------------------------
// 6. rrfMerge: entry in both lists ranks higher than entry in one list
// ---------------------------------------------------------------------------

describe('rrfMerge — ranking', () => {
  it('entry in both lists scores higher than entry in only one list', () => {
    const shared: MemoryEntry & { _rank: number } = {
      id: 'shared',
      type: 'assertion',
      content: 'shared content',
      tags: [],
      created_at: new Date().toISOString(),
      _rank: 0,
    }
    const onlyInA: MemoryEntry & { _rank: number } = {
      id: 'only-a',
      type: 'assertion',
      content: 'only in list a',
      tags: [],
      created_at: new Date().toISOString(),
      _rank: 1,
    }
    const onlyInB: MemoryEntry & { _rank: number } = {
      id: 'only-b',
      type: 'assertion',
      content: 'only in list b',
      tags: [],
      created_at: new Date().toISOString(),
      _rank: 1,
    }

    const result = rrfMerge([shared, onlyInA], [shared, onlyInB])
    expect(result[0]!.id).toBe('shared')
  })
})

// ---------------------------------------------------------------------------
// 7. buildEpisodicMemoryInjection: empty entries returns empty string
// ---------------------------------------------------------------------------

describe('buildEpisodicMemoryInjection', () => {
  it('returns empty string for no entries', () => {
    expect(buildEpisodicMemoryInjection([])).toBe('')
  })

  // ---------------------------------------------------------------------------
  // 8. buildEpisodicMemoryInjection: formats entries with type and content
  // ---------------------------------------------------------------------------

  it('formats entries with type and content wrapped in episodic_memories tags', () => {
    const entries: MemoryEntry[] = [
      {
        id: '1',
        type: 'preference',
        content: 'prefer dark mode',
        tags: [],
        created_at: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'decision',
        content: 'chose PostgreSQL for storage',
        tags: [],
        created_at: new Date().toISOString(),
      },
    ]

    const result = buildEpisodicMemoryInjection(entries)
    expect(result).toBe(
      '<episodic_memories>\n- [preference] prefer dark mode\n- [decision] chose PostgreSQL for storage\n</episodic_memories>',
    )
  })
})
