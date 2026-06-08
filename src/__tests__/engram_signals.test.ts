import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Override KOA_HOME so all signal writes go to a temp dir during tests
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-signals-test-'));
  process.env['KOA_HOME'] = tmpDir;
});

afterEach(() => {
  delete process.env['KOA_HOME'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Import after env is set so the module uses the overridden KOA_HOME
async function getSignalFns() {
  // Use dynamic import with cache-busting to ensure env override is respected
  const mod = await import('../engram/signals.js');
  return { emitSignal: mod.emitSignal, readRecentSignals: mod.readRecentSignals };
}

describe('emitSignal', () => {
  it('writes a JSONL line to ~/.koa/signals/engram.jsonl', async () => {
    const { emitSignal } = await getSignalFns();
    emitSignal('thin-context', 'no goal set');

    const filePath = path.join(tmpDir, '.koa', 'signals', 'engram.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('thin-context');
    expect(parsed.detail).toBe('no goal set');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends multiple signals as separate lines', async () => {
    const { emitSignal } = await getSignalFns();
    emitSignal('thin-context', 'first');
    emitSignal('empty-query', 'second');

    const filePath = path.join(tmpDir, '.koa', 'signals', 'engram.jsonl');
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).type).toBe('thin-context');
    expect(JSON.parse(lines[1]!).type).toBe('empty-query');
  });
});

describe('readRecentSignals', () => {
  it('returns empty array when file does not exist', async () => {
    const { readRecentSignals } = await getSignalFns();
    const result = readRecentSignals(10);
    expect(result).toEqual([]);
  });

  it('reads back signals that were emitted', async () => {
    const { emitSignal, readRecentSignals } = await getSignalFns();
    emitSignal('slow-sync', 'sync took 20000ms');
    emitSignal('failed-call', 'rememberSession threw');

    const signals = readRecentSignals(10);
    expect(signals).toHaveLength(2);
    expect(signals[0]!.type).toBe('slow-sync');
    expect(signals[1]!.type).toBe('failed-call');
  });

  it('returns only the last n signals', async () => {
    const { emitSignal, readRecentSignals } = await getSignalFns();
    for (let i = 0; i < 5; i++) {
      emitSignal('empty-query', `query ${i}`);
    }
    const signals = readRecentSignals(3);
    expect(signals).toHaveLength(3);
    expect(signals[2]!.detail).toBe('query 4');
  });
});

describe('cross_repo_write path traversal guard', () => {
  it('rejects relPath containing ..', async () => {
    const { crossRepoWriteTool } = await import('../agent/tools/cross_repo.js');
    await expect(
      crossRepoWriteTool.execute({ repo: 'engram', relPath: '../../../etc/passwd', content: 'evil' }),
    ).rejects.toThrow('Path traversal rejected');
  });

  it('rejects unknown repo', async () => {
    const { crossRepoWriteTool } = await import('../agent/tools/cross_repo.js');
    await expect(
      crossRepoWriteTool.execute({ repo: 'evil-repo', relPath: 'file.txt', content: 'data' }),
    ).rejects.toThrow('Unknown repo');
  });

  it('rejects unknown repo for read', async () => {
    const { crossRepoReadTool } = await import('../agent/tools/cross_repo.js');
    await expect(
      crossRepoReadTool.execute({ repo: 'notallowed', relPath: 'file.txt' }),
    ).rejects.toThrow('Unknown repo');
  });
});
