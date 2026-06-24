import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Integration } from '../integrations/store.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeIntegration(overrides: Partial<Integration> = {}) {
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

// ── saveIntegration / loadIntegrations — round-trip ──────────────────────────

describe('saveIntegration / loadIntegrations — atomic write', () => {
  it('persists an integration and loads it back with matching data', async () => {
    const { saveIntegration, loadIntegrations } = await import('../integrations/store.js');

    const integration = makeIntegration({ id: 'rt-1', name: 'Round Trip' });
    saveIntegration(integration);

    const loaded = loadIntegrations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(integration);
  });

  it('overwrites an existing integration when saved again with a change', async () => {
    const { saveIntegration, loadIntegrations } = await import('../integrations/store.js');

    saveIntegration(makeIntegration({ id: 'rt-2', name: 'Before' }));
    saveIntegration(makeIntegration({ id: 'rt-2', name: 'After' }));

    const loaded = loadIntegrations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.name).toBe('After');
  });
});

// ── mergeConfig — secret preservation ────────────────────────────────────────

describe('mergeConfig — secret preservation', () => {
  it('retains the original secret when submitted value is "***"', async () => {
    const { mergeConfig } = await import('../integrations/store.js');

    const existing = { botToken: 'xoxb-real-secret', channel: '#general' };
    const submitted = { botToken: '***', channel: '#announcements' };

    const merged = mergeConfig(existing, submitted, 'slack');

    // Secret must not be overwritten with the placeholder
    expect(merged['botToken']).toBe('xoxb-real-secret');
    // Non-secret field must be updated
    expect(merged['channel']).toBe('#announcements');
  });

  it('updates a secret field when a real value (not "***") is submitted', async () => {
    const { mergeConfig } = await import('../integrations/store.js');

    const existing = { botToken: 'xoxb-old', channel: '#general' };
    const submitted = { botToken: 'xoxb-new', channel: '#general' };

    const merged = mergeConfig(existing, submitted, 'slack');

    expect(merged['botToken']).toBe('xoxb-new');
  });
});

// ── maskSecrets — field-level coverage ───────────────────────────────────────

describe('maskSecrets — SECRET_FIELDS replacement', () => {
  it('replaces exactly the SECRET_FIELDS values with "***"', async () => {
    const { maskSecrets } = await import('../integrations/store.js');

    // github has a single secret field: token
    const integration = makeIntegration({
      id: 'gh-1',
      type: 'github',
      config: { token: 'ghp_supersecret', org: 'rwgb' },
    });
    const masked = maskSecrets(integration);

    expect(masked.config['token']).toBe('***');
  });

  it('leaves non-secret fields untouched', async () => {
    const { maskSecrets } = await import('../integrations/store.js');

    const integration = makeIntegration({
      id: 'gh-2',
      type: 'github',
      config: { token: 'ghp_supersecret', org: 'rwgb' },
    });
    const masked = maskSecrets(integration);

    expect(masked.config['org']).toBe('rwgb');
  });

  it('does not mutate the original integration object', async () => {
    const { maskSecrets } = await import('../integrations/store.js');

    const integration = makeIntegration();
    maskSecrets(integration);

    // original must still hold the real secret
    expect(integration.config['botToken']).toBe('xoxb-secret');
  });
});

// ── deleteIntegration — return value and removal ──────────────────────────────

describe('deleteIntegration', () => {
  it('returns false for an unknown id', async () => {
    const { deleteIntegration } = await import('../integrations/store.js');

    const result = deleteIntegration('does-not-exist');

    expect(result).toBe(false);
  });

  it('returns true and removes the integration for a known id', async () => {
    const { saveIntegration, loadIntegrations, deleteIntegration } = await import(
      '../integrations/store.js'
    );

    saveIntegration(makeIntegration({ id: 'to-delete' }));

    const result = deleteIntegration('to-delete');

    expect(result).toBe(true);
    const remaining = loadIntegrations();
    expect(remaining.find(i => i.id === 'to-delete')).toBeUndefined();
  });

  it('leaves other integrations intact after deletion', async () => {
    const { saveIntegration, loadIntegrations, deleteIntegration } = await import(
      '../integrations/store.js'
    );

    saveIntegration(makeIntegration({ id: 'keep-me' }));
    saveIntegration(makeIntegration({ id: 'remove-me' }));

    deleteIntegration('remove-me');

    const remaining = loadIntegrations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe('keep-me');
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
