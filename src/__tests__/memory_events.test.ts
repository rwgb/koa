import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { initSchema } from '../memory/db.js'
import { writeMemoryEvent } from '../memory/events.js'
import type { MemoryEventType, NewMemoryEntry } from '../memory/schema.js'

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
    `koa-events-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  tempPaths.push(p)
  const db = new BetterSqlite3(p)
  initSchema(db)
  openDbs.push(db)
  return db
}

function countRows(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM memory_entries').get() as { n: number }).n
}

function countFtsRows(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM memory_fts').get() as { n: number }).n
}

// ---------------------------------------------------------------------------
// 1. Each of the 8 types writes successfully and returns a MemoryEntry with id
// ---------------------------------------------------------------------------

const ALL_TYPES: MemoryEventType[] = [
  'preference', 'standing-order', 'boundary', 'assertion', 'correction',
  'decision', 'failure', 'journal',
]

describe('writeMemoryEvent — all 8 types', () => {
  for (const type of ALL_TYPES) {
    it(`writes '${type}' and returns a MemoryEntry with an id`, () => {
      const db = makeTempDb()
      const entry: NewMemoryEntry = { type, content: `test content for ${type}`, tags: ['a'] }
      const result = writeMemoryEvent(entry, undefined, db)

      expect(result.id).toBeTypeOf('string')
      expect(result.id.length).toBeGreaterThan(0)
      expect(result.type).toBe(type)
      expect(result.content).toBe(entry.content)
      expect(result.tags).toEqual(['a'])
      expect(result.created_at).toBeTypeOf('string')
    })
  }
})

// ---------------------------------------------------------------------------
// 2 & 3. Global vs project DB routing — tested via the db override parameter.
//         We simply verify the correct DB receives the write (row count check).
// ---------------------------------------------------------------------------

describe('writeMemoryEvent — DB routing', () => {
  const GLOBAL_TYPES: MemoryEventType[] = ['preference', 'assertion', 'boundary', 'correction', 'standing-order']
  const PROJECT_TYPES: MemoryEventType[] = ['decision', 'failure', 'journal']

  it('global-type entries are written to the provided DB (simulating global DB)', () => {
    const db = makeTempDb()
    for (const type of GLOBAL_TYPES) {
      writeMemoryEvent({ type, content: `content-${type}`, tags: [] }, undefined, db)
    }
    // Each type is unique content — expect 5 rows
    expect(countRows(db)).toBe(GLOBAL_TYPES.length)
  })

  it('project-type entries are written to the provided DB (simulating project DB)', () => {
    const db = makeTempDb()
    for (const type of PROJECT_TYPES) {
      writeMemoryEvent({ type, content: `content-${type}`, tags: [] }, undefined, db)
    }
    expect(countRows(db)).toBe(PROJECT_TYPES.length)
  })
})

// ---------------------------------------------------------------------------
// 4. Assertion dedup: same content twice → 1 row in memory_entries
// ---------------------------------------------------------------------------

describe('writeMemoryEvent — assertion dedup', () => {
  it('same content twice → 1 row', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = { type: 'assertion', content: 'the sky is blue', tags: [] }

    const first = writeMemoryEvent(entry, undefined, db)
    const second = writeMemoryEvent(entry, undefined, db)

    expect(countRows(db)).toBe(1)
    // Both calls return the same id
    expect(first.id).toBe(second.id)
  })

  // ---------------------------------------------------------------------------
  // 5. Assertion dedup: different content → 2 rows
  // ---------------------------------------------------------------------------

  it('different content → 2 rows', () => {
    const db = makeTempDb()

    writeMemoryEvent({ type: 'assertion', content: 'the sky is blue', tags: [] }, undefined, db)
    writeMemoryEvent({ type: 'assertion', content: 'the grass is green', tags: [] }, undefined, db)

    expect(countRows(db)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 6. Standing-order dedup: same content → 1 row; different content → 2 rows
// ---------------------------------------------------------------------------

describe('writeMemoryEvent — standing-order dedup', () => {
  it('same content → 1 row', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = {
      type: 'standing-order',
      content: 'always greet with hello',
      tags: [],
      action_type: 'brief',
    }

    const first = writeMemoryEvent(entry, undefined, db)
    const second = writeMemoryEvent(entry, undefined, db)

    expect(countRows(db)).toBe(1)
    expect(first.id).toBe(second.id)
  })

  it('different content → 2 rows', () => {
    const db = makeTempDb()

    writeMemoryEvent(
      { type: 'standing-order', content: 'greet with hello', tags: [], action_type: 'brief' },
      undefined,
      db,
    )
    writeMemoryEvent(
      { type: 'standing-order', content: 'end with goodbye', tags: [], action_type: 'brief' },
      undefined,
      db,
    )

    expect(countRows(db)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 7. Journal: no dedup — same content twice → 2 rows
// ---------------------------------------------------------------------------

describe('writeMemoryEvent — journal no dedup', () => {
  it('same content twice → 2 rows', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = { type: 'journal', content: 'today I learned something', tags: [] }

    writeMemoryEvent(entry, undefined, db)
    writeMemoryEvent(entry, undefined, db)

    expect(countRows(db)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 8. FTS populated: after writing an assertion, memory_fts returns 1 hit
// ---------------------------------------------------------------------------

describe('writeMemoryEvent — FTS population', () => {
  it('writing an assertion populates memory_fts with 1 row', () => {
    const db = makeTempDb()
    const content = 'typescript is statically typed'

    writeMemoryEvent({ type: 'assertion', content, tags: [] }, undefined, db)

    expect(countFtsRows(db)).toBe(1)

    const hits = db
      .prepare('SELECT entry_id FROM memory_fts WHERE content MATCH ?')
      .all(content) as Array<{ entry_id: string }>

    expect(hits).toHaveLength(1)
  })

  it('each distinct write adds a FTS row', () => {
    const db = makeTempDb()

    writeMemoryEvent({ type: 'preference', content: 'prefer dark mode', tags: [] }, undefined, db)
    writeMemoryEvent({ type: 'decision', content: 'chose PostgreSQL', tags: [] }, undefined, db)

    expect(countFtsRows(db)).toBe(2)
  })
})
