import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIntegration(overrides: Partial<import('../integrations/store.js').Integration> = {}) {
  return {
    id: 'test-1',
    type: 'slack',
    name: 'Slack',
    status: 'connected' as const,
    config: { webhookUrl: 'https://hooks.slack.com/foo', botToken: 'xoxb-secret' },
    ...overrides,
  };
}

// ── module reset between tests ────────────────────────────────────────────────
// Each beforeEach re-imports the module with a fresh cache state by pointing
// KOA_HOME at a temp directory and relying on the file-not-found path to
// reset the in-memory _cache (saveIntegration / deleteIntegration set _cache=null).

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-integrations-test-'));
  process.env['KOA_HOME'] = tempDir;
  vi.resetModules(); // ensure fresh _cache on each test
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
  vi.restoreAllMocks();
});

// ── loadIntegrations — cache hit ──────────────────────────────────────────────

describe('loadIntegrations() — TTL cache', () => {
  it('reads disk only once for 3 calls within 100 ms', async () => {
    const { loadIntegrations, saveIntegration } = await import('../integrations/store.js');

    // Seed disk with one integration so readFileSync actually returns data
    saveIntegration(makeIntegration());

    const spy = vi.spyOn(fs, 'readFileSync');

    // Three rapid calls — only the first should hit the filesystem
    loadIntegrations();
    loadIntegrations();
    loadIntegrations();

    const readCalls = spy.mock.calls.filter(
      args => typeof args[0] === 'string' && (args[0] as string).endsWith('integrations.json'),
    );
    expect(readCalls).toHaveLength(1);
  });

  it('re-reads disk after cache expires (fake timers)', async () => {
    vi.useFakeTimers();
    const { loadIntegrations, saveIntegration } = await import('../integrations/store.js');

    saveIntegration(makeIntegration());

    const spy = vi.spyOn(fs, 'readFileSync');

    loadIntegrations(); // populates cache — 1 read
    vi.advanceTimersByTime(6_000); // advance past 5 s TTL
    loadIntegrations(); // cache expired — 1 more read

    const readCalls = spy.mock.calls.filter(
      args => typeof args[0] === 'string' && (args[0] as string).endsWith('integrations.json'),
    );
    expect(readCalls).toHaveLength(2);

    vi.useRealTimers();
  });
});

// ── saveIntegration — cache invalidation ─────────────────────────────────────

describe('saveIntegration() — cache invalidation', () => {
  it('forces a disk re-read on the next loadIntegrations() call', async () => {
    const { loadIntegrations, saveIntegration } = await import('../integrations/store.js');

    saveIntegration(makeIntegration({ id: 'a', name: 'First' }));

    const spy = vi.spyOn(fs, 'readFileSync');

    loadIntegrations(); // 1st read — fills cache

    // Save a second integration — should invalidate cache
    saveIntegration(makeIntegration({ id: 'b', name: 'Second' }));

    loadIntegrations(); // cache was invalidated — 2nd read

    const readCalls = spy.mock.calls.filter(
      args => typeof args[0] === 'string' && (args[0] as string).endsWith('integrations.json'),
    );
    expect(readCalls).toHaveLength(2);

    // And the returned list should contain both integrations
    const all = loadIntegrations();
    expect(all.map(i => i.id)).toEqual(['a', 'b']);
  });
});

// ── deleteIntegration — cache invalidation ────────────────────────────────────

describe('deleteIntegration() — cache invalidation', () => {
  it('forces a disk re-read after deletion', async () => {
    const { loadIntegrations, saveIntegration, deleteIntegration } = await import(
      '../integrations/store.js'
    );

    saveIntegration(makeIntegration({ id: 'x' }));
    loadIntegrations(); // fill cache

    const spy = vi.spyOn(fs, 'readFileSync');

    deleteIntegration('x'); // invalidates cache
    loadIntegrations(); // must re-read

    const readCalls = spy.mock.calls.filter(
      args => typeof args[0] === 'string' && (args[0] as string).endsWith('integrations.json'),
    );
    expect(readCalls).toHaveLength(1);

    // Deleted item should be gone
    const all = loadIntegrations();
    expect(all.find(i => i.id === 'x')).toBeUndefined();
  });
});

// ── maskSecrets ───────────────────────────────────────────────────────────────

describe('maskSecrets()', () => {
  it('masks webhookUrl and botToken for slack integrations', async () => {
    const { maskSecrets } = await import('../integrations/store.js');

    const integration = makeIntegration();
    const masked = maskSecrets(integration);

    expect(masked.config['webhookUrl']).toBe('***');
    expect(masked.config['botToken']).toBe('***');
  });

  it('preserves non-secret fields for slack integrations', async () => {
    const { maskSecrets } = await import('../integrations/store.js');

    const integration = makeIntegration({
      config: { webhookUrl: 'https://hooks.slack.com/foo', botToken: 'xoxb-secret', channel: '#general' },
    });
    const masked = maskSecrets(integration);

    expect(masked.config['channel']).toBe('#general');
  });

  it('does not mask fields for ntfy (no secret fields)', async () => {
    const { maskSecrets } = await import('../integrations/store.js');

    const ntfy = makeIntegration({
      type: 'ntfy',
      config: { topic: 'my-topic', baseUrl: 'https://ntfy.sh' },
    });
    const masked = maskSecrets(ntfy);

    expect(masked.config['topic']).toBe('my-topic');
    expect(masked.config['baseUrl']).toBe('https://ntfy.sh');
  });
});

// ── atomic write ──────────────────────────────────────────────────────────────

describe('atomic write', () => {
  it('saveIntegration writes via .tmp then renames', async () => {
    const { saveIntegration } = await import('../integrations/store.js');

    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');

    saveIntegration(makeIntegration());

    const tmpWrite = writeSpy.mock.calls.find(
      args => typeof args[0] === 'string' && (args[0] as string).endsWith('.tmp'),
    );
    expect(tmpWrite).toBeDefined();

    const renameCall = renameSpy.mock.calls.find(
      args => typeof args[1] === 'string' && (args[1] as string).endsWith('integrations.json'),
    );
    expect(renameCall).toBeDefined();
    expect(renameCall![0]).toMatch(/\.tmp$/);
  });

  it('deleteIntegration writes via .tmp then renames', async () => {
    const { saveIntegration, deleteIntegration } = await import('../integrations/store.js');

    saveIntegration(makeIntegration({ id: 'del-me' }));

    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');

    deleteIntegration('del-me');

    const tmpWrite = writeSpy.mock.calls.find(
      args => typeof args[0] === 'string' && (args[0] as string).endsWith('.tmp'),
    );
    expect(tmpWrite).toBeDefined();

    const renameCall = renameSpy.mock.calls.find(
      args => typeof args[1] === 'string' && (args[1] as string).endsWith('integrations.json'),
    );
    expect(renameCall).toBeDefined();
    expect(renameCall![0]).toMatch(/\.tmp$/);
  });
});
