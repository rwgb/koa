import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isCodeQuery, hasBacklogSignals } from '../agent/loop.js';
import { ResponseCache } from '../agent/cache.js';

// ── isCodeQuery ──────────────────────────────────────────────────────────────

describe('isCodeQuery()', () => {
  it('returns true for messages containing code signals', () => {
    expect(isCodeQuery('What does the buildSystemPrompt function do?')).toBe(true);
    expect(isCodeQuery('There is a bug in src/agent/loop.ts')).toBe(true);
    expect(isCodeQuery('import the module')).toBe(true);
    expect(isCodeQuery('fix the type error')).toBe(true);
    expect(isCodeQuery('run the test suite')).toBe(true);
    expect(isCodeQuery('build the project')).toBe(true);
  });

  it('returns false for non-code messages', () => {
    expect(isCodeQuery("What's the weather like today?")).toBe(false);
    expect(isCodeQuery('Summarise my last session')).toBe(false);
    expect(isCodeQuery('How much did I spend this week?')).toBe(false);
  });
});

// ── hasBacklogSignals ────────────────────────────────────────────────────────

describe('hasBacklogSignals()', () => {
  it('returns true for planning-related messages', () => {
    expect(hasBacklogSignals('what task should I do next?')).toBe(true);
    expect(hasBacklogSignals('show me the backlog')).toBe(true);
    expect(hasBacklogSignals("what's left to do?")).toBe(true);
    expect(hasBacklogSignals('create a plan for the sprint')).toBe(true);
    expect(hasBacklogSignals('what is the priority?')).toBe(true);
    expect(hasBacklogSignals('should we add tests?')).toBe(true);
    expect(hasBacklogSignals('checkpoint')).toBe(true);
  });

  it('returns false for ordinary chat messages', () => {
    expect(hasBacklogSignals('explain this error')).toBe(false);
    expect(hasBacklogSignals('hello, how are you?')).toBe(false);
    expect(hasBacklogSignals('fix the auth bug')).toBe(false);
  });
});

// ── ResponseCache ────────────────────────────────────────────────────────────

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache();
  });

  it('returns undefined on cache miss', () => {
    expect(cache.get(ResponseCache.key('hash', 'message'))).toBeUndefined();
  });

  it('returns stored value on cache hit', () => {
    const key = ResponseCache.key('hash', 'hello');
    cache.set(key, 'world');
    expect(cache.get(key)).toBe('world');
  });

  it('different messages produce different keys', () => {
    const k1 = ResponseCache.key('hash', 'hello');
    const k2 = ResponseCache.key('hash', 'goodbye');
    expect(k1).not.toBe(k2);
  });

  it('evicts oldest entry when max size is reached', () => {
    // Fill to 50 entries
    for (let i = 0; i < 50; i++) {
      cache.set(ResponseCache.key('h', `msg-${i}`), `val-${i}`);
    }
    expect(cache.size).toBe(50);

    // Adding a 51st entry evicts the oldest
    cache.set(ResponseCache.key('h', 'msg-overflow'), 'overflow-val');
    expect(cache.size).toBe(50);

    // Oldest entry (msg-0) should have been evicted
    expect(cache.get(ResponseCache.key('h', 'msg-0'))).toBeUndefined();
    // Newest entry should exist
    expect(cache.get(ResponseCache.key('h', 'msg-overflow'))).toBe('overflow-val');
  });

  it('returns undefined for expired entries', async () => {
    const originalEnv = process.env['KOA_CACHE_TTL_SECONDS'];
    // TTL is read at module load time, so we test expiry by manipulating Date.now
    const key = ResponseCache.key('hash', 'expiring');
    cache.set(key, 'expires');

    // Mock Date.now to be 61 seconds in the future
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockReturnValue(realNow() + 61_000);

    expect(cache.get(key)).toBeUndefined();

    vi.restoreAllMocks();
    void originalEnv;
  });

  it('generates stable SHA-256 keys', () => {
    const k1 = ResponseCache.key('abc', 'hello world');
    const k2 = ResponseCache.key('abc', 'hello world');
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64); // SHA-256 hex
  });
});

// ── CONFIG_MODEL_MAP tier translation ────────────────────────────────────────

describe('CONFIG_MODEL_MAP', () => {
  it('maps tier aliases to model strings', async () => {
    const { CONFIG_MODEL_MAP } = await import('../types/index.js');
    expect(CONFIG_MODEL_MAP.fast).toBe('claude-haiku-4-5-20251001');
    expect(CONFIG_MODEL_MAP.standard).toBe('claude-sonnet-4-6');
    expect(CONFIG_MODEL_MAP.powerful).toBe('claude-opus-4-7');
  });
});
