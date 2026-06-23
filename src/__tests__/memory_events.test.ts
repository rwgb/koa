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
// GAP-11a. Dedup — duplicate assertion bumps created_at (used as sort key)
// ---------------------------------------------------------------------------

describe('writeMemoryEvent dedup — duplicate assertion bumps updated_at', () => {
  it('writing the same assertion twice bumps created_at and keeps 1 row', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = { type: 'assertion', content: 'the earth orbits the sun', tags: [] }

    const first = writeMemoryEvent(entry, undefined, db)

    // Capture the created_at stored in the DB after the first write
    const afterFirst = (
      db.prepare('SELECT created_at FROM memory_entries WHERE id = ?').get(first.id) as {
        created_at: string
      }
    ).created_at

    // Small delay so SQLite datetime('now') can advance at least 1 second
    const waitUntil = Date.now() + 1100
    while (Date.now() < waitUntil) { /* spin */ }

    const second = writeMemoryEvent(entry, undefined, db)

    // Still only 1 row
    expect(countRows(db)).toBe(1)
    // Same id returned
    expect(second.id).toBe(first.id)

    // The DB created_at must be strictly later than after the first write
    const afterSecond = (
      db.prepare('SELECT created_at FROM memory_entries WHERE id = ?').get(first.id) as {
        created_at: string
      }
    ).created_at

    expect(afterSecond > afterFirst).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// GAP-11b. Dedup — FTS special characters do not throw; entry is inserted
// ---------------------------------------------------------------------------

describe('writeMemoryEvent dedup — FTS special characters do not throw', () => {
  it('content with parentheses, quotes, and hyphens inserts without throwing', () => {
    const db = makeTempDb()
    const specialContent = '(test) "quoted" - dash'
    const entry: NewMemoryEntry = { type: 'assertion', content: specialContent, tags: [] }

    // Must not throw — FTS catch block swallows the error and falls through to insert
    let result: ReturnType<typeof writeMemoryEvent> | undefined
    expect(() => {
      result = writeMemoryEvent(entry, undefined, db)
    }).not.toThrow()

    expect(result).toBeDefined()
    expect(result!.content).toBe(specialContent)
    // Row exists in the DB
    expect(countRows(db)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// GAP-11c. Non-assertion types — standing-order is in DEDUP_TYPES, so same
//          content yields 1 row (dedup applies, same as assertion)
// ---------------------------------------------------------------------------

describe('writeMemoryEvent — non-assertion types always insert', () => {
  it('standing-order with the same content dedups to 1 row', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = {
      type: 'standing-order',
      content: 'respond concisely',
      tags: [],
      action_type: 'brief',
    }

    const first = writeMemoryEvent(entry, undefined, db)
    const second = writeMemoryEvent(entry, undefined, db)

    // standing-order IS in DEDUP_TYPES — same content results in 1 row, same id
    expect(countRows(db)).toBe(1)
    expect(first.id).toBe(second.id)
  })
})

// ---------------------------------------------------------------------------
// GAP-11d. rowToEntry — correct field mapping
// ---------------------------------------------------------------------------

describe('rowToEntry — correct field mapping', () => {
  it('written entry is read back with correct type, content, tags, and id', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = {
      type: 'standing-order',
      content: 'always check the HANDOFF',
      tags: ['memory', 'workflow'],
      action_type: 'brief',
      trigger_pattern: 'session start',
    }

    const result = writeMemoryEvent(entry, undefined, db)

    expect(result.id).toBeTypeOf('string')
    expect(result.id.length).toBeGreaterThan(0)
    expect(result.type).toBe('standing-order')
    expect(result.content).toBe('always check the HANDOFF')
    expect(result.tags).toEqual(['memory', 'workflow'])
    expect(result.action_type).toBe('brief')
    expect(result.trigger_pattern).toBe('session start')
    expect(result.created_at).toBeTypeOf('string')
    expect(result.expires_at).toBeUndefined()
  })

  it('optional fields absent from entry are undefined in returned MemoryEntry', () => {
    const db = makeTempDb()
    const entry: NewMemoryEntry = {
      type: 'assertion',
      content: 'the sky is blue',
      tags: [],
    }

    const result = writeMemoryEvent(entry, undefined, db)

    expect(result.action_type).toBeUndefined()
    expect(result.trigger_pattern).toBeUndefined()
    expect(result.expires_at).toBeUndefined()
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
