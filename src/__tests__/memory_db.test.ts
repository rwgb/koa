import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync, mkdirSync } from 'node:fs'
import type Database from 'better-sqlite3'

// Track open DBs and temp paths for cleanup
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

function makeTempPath(suffix: string): string {
  const p = join(tmpdir(), `koa-memory-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}.db`)
  tempPaths.push(p)
  return p
}

// Import helpers - note: the singleton cache is module-level so we must use unique paths per test
import { getGlobalMemoryDb, getProjectMemoryDb, initSchema } from '../memory/db.js'

describe('getGlobalMemoryDb', () => {
  it('creates the memory_entries table at a temp path', () => {
    const p = makeTempPath('global')
    const db = getGlobalMemoryDb(p)
    openDbs.push(db)

    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries'`)
      .get() as { name: string } | undefined

    expect(row?.name).toBe('memory_entries')
  })
})

describe('getProjectMemoryDb', () => {
  it('creates the memory_entries table at a temp path', () => {
    const p = makeTempPath('project')
    const db = getProjectMemoryDb('test-slug', p)
    openDbs.push(db)

    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_entries'`)
      .get() as { name: string } | undefined

    expect(row?.name).toBe('memory_entries')
  })
})

describe('initSchema', () => {
  it('is idempotent — calling twice does not throw', () => {
    const p = makeTempPath('idempotent')
    const db = getGlobalMemoryDb(p)
    openDbs.push(db)

    expect(() => initSchema(db)).not.toThrow()
    expect(() => initSchema(db)).not.toThrow()
  })
})

describe('getGlobalMemoryDb singleton', () => {
  it('returns the same instance for the same path', () => {
    const p = makeTempPath('singleton')
    const db1 = getGlobalMemoryDb(p)
    const db2 = getGlobalMemoryDb(p)
    openDbs.push(db1)

    expect(db1).toBe(db2)
  })
})

describe('memory_fts virtual table', () => {
  it('exists after schema initialisation', () => {
    const p = makeTempPath('fts')
    const db = getGlobalMemoryDb(p)
    openDbs.push(db)

    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'`)
      .get() as { name: string } | undefined

    expect(row?.name).toBe('memory_fts')
  })
})
