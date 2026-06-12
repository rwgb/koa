import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;
const originalEnv = process.env;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-memory-store-test-'));
  process.env = { ...originalEnv, KOA_HOME: tmpDir };
});

afterEach(() => {
  process.env = originalEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function memoryFilePath(): string {
  return path.join(tmpDir, '.koa', 'memory.json');
}

// Import under test after KOA_HOME is set (module reads env at call time via
// the memoryFilePath() closure, so fresh imports per test aren't needed).
import { loadMemories, addMemory, removeMemory } from './store.js';

// ──────────────────────────────────────────────────────────────────────────────
// read() — ENOENT vs. parse error
// ──────────────────────────────────────────────────────────────────────────────

describe('loadMemories() when file is absent', () => {
  it('returns [] without throwing', () => {
    expect(loadMemories()).toEqual([]);
  });
});

describe('loadMemories() when file contains garbage JSON', () => {
  it('returns [] AND renames the corrupt file to a .corrupt-<timestamp> path', () => {
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(memoryFilePath(), 'THIS IS NOT JSON', { mode: 0o600 });

    const result = loadMemories();

    expect(result).toEqual([]);

    // A .corrupt-* file must now exist in the .koa directory.
    const entries = fs.readdirSync(koaDir);
    const corruptFiles = entries.filter((e) => e.startsWith('memory.json.corrupt-'));
    expect(corruptFiles.length).toBe(1);
  });

  it('allows subsequent addMemory to work correctly after recovery', () => {
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(memoryFilePath(), '{ bad json }', { mode: 0o600 });

    // Trigger recovery.
    loadMemories();

    // The store must now be usable.
    addMemory('recovery works');
    const memories = loadMemories();
    expect(memories).toHaveLength(1);
    expect(memories[0]!.fact).toBe('recovery works');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// write() — atomic tmp filename
// ──────────────────────────────────────────────────────────────────────────────

describe('addMemory() atomic write', () => {
  it('leaves no .tmp file behind after a successful write', () => {
    addMemory('atomic test');

    const koaDir = path.join(tmpDir, '.koa');
    const entries = fs.readdirSync(koaDir);
    const tmpFiles = entries.filter((e) => e.endsWith('.tmp'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('persists the memory so a subsequent read returns it', () => {
    addMemory('persistent fact');
    const memories = loadMemories();
    expect(memories.map((m) => m.fact)).toContain('persistent fact');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// removeMemory() — whole-fact exact match (not substring)
// ──────────────────────────────────────────────────────────────────────────────

describe('removeMemory() exact match', () => {
  beforeEach(() => {
    addMemory('running shoes');
    addMemory('go for a run');
  });

  it('removes only the exact fact "go for a run", leaving "running shoes" intact', () => {
    const removed = removeMemory('go for a run');
    expect(removed).toBe(true);

    const remaining = loadMemories().map((m) => m.fact);
    expect(remaining).toContain('running shoes');
    expect(remaining).not.toContain('go for a run');
  });

  it('removing "run" does NOT match either entry (substring, not exact)', () => {
    const removed = removeMemory('run');
    expect(removed).toBe(false);

    const remaining = loadMemories().map((m) => m.fact);
    expect(remaining).toContain('running shoes');
    expect(remaining).toContain('go for a run');
  });

  it('is case-insensitive for the exact match', () => {
    const removed = removeMemory('GO FOR A RUN');
    expect(removed).toBe(true);

    const remaining = loadMemories().map((m) => m.fact);
    expect(remaining).toContain('running shoes');
    expect(remaining).not.toContain('go for a run');
  });

  it('returns false and leaves the store unchanged when fact is not present', () => {
    const before = loadMemories().length;
    const removed = removeMemory('marathon training');
    expect(removed).toBe(false);
    expect(loadMemories()).toHaveLength(before);
  });
});
