/**
 * H-8: Security Invariant Suite
 *
 * This file asserts the most critical security invariants across the Koa codebase.
 * Each describe block names the invariant and cites the source that enforces it.
 *
 * Scope: invariants ONLY — behavior that must never regress regardless of refactoring.
 * Unit-level coverage of these same functions lives in their own test files; this
 * suite focuses on the guarantee, not the implementation detail.
 *
 * Related test files:
 *   - src/__tests__/cross_repo.test.ts    (unit coverage of path-traversal guard)
 *   - src/__tests__/ssrf.test.ts          (unit coverage of validateSafeUrl)
 *   - src/__tests__/server_routes.test.ts (HTTP auth matrix, busy-429 for POST /api/chat)
 *   - src/__tests__/bash_tool.test.ts     (bash tool happy/error paths)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Shared mock setup for server tests ───────────────────────────────────────
// These are identical to the setup in server_routes.test.ts — required because
// createServer() imports and starts background services at module load time.

vi.mock('../../channels/gmail.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../channels/gmail.js')>();
  return { ...actual, gmailPoller: { start: vi.fn(), stop: vi.fn() } };
});

vi.mock('../../calendar/sync.js', () => ({
  calendarSync: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../../notifications/escalation.js', () => ({
  escalationScheduler: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../../channels/telegram.js', () => ({
  TelegramPoller: class { start = vi.fn(); stop = vi.fn(); },
}));

vi.mock('../../channels/router.js', () => ({
  setTelegramPoller: vi.fn(),
  routeResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/credentials.js', () => ({
  readCredentials: vi.fn().mockReturnValue({}),
  writeCredential: vi.fn(),
  deleteCredential: vi.fn(),
  getCredentialsPath: vi.fn().mockReturnValue('/tmp/koa-test-creds'),
}));

vi.mock('../../voice/tts.js', () => ({
  synthesizeStream: vi.fn(),
}));

vi.mock('../../proactive/briefing.js', () => ({
  buildDailyBriefing: vi.fn().mockResolvedValue('briefing'),
}));

vi.mock('../../proactive/delegations.js', () => ({
  runDueDelegations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../integrations/store.js', () => ({
  loadIntegrations: vi.fn().mockReturnValue([]),
  saveIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  maskSecrets: vi.fn((x: unknown) => x),
  mergeConfig: vi.fn(),
  ALLOWED_TYPES: ['gmail', 'google-calendar', 'slack', 'twilio'],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import type { TurnResult } from '../../types/index.js';

function makeFakeLoop(overrides: Partial<{
  turn: () => Promise<TurnResult>;
  checkpoint: () => Promise<void>;
  rebuildBrain: () => Promise<string>;
  getState: () => object;
  contextStats: () => object;
  initialize: () => Promise<void>;
  finalize: () => Promise<void>;
}> = {}) {
  const defaultResult: TurnResult = {
    content: 'hello',
    toolUses: [],
    stopReason: 'end_turn',
    model: 'claude-sonnet-4-5',
    tier: 'sonnet',
    agent: 'code-assistant',
    usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, model: 'test', agent: 'code-assistant' as const },
  };
  return {
    turn: vi.fn().mockResolvedValue(defaultResult),
    checkpoint: vi.fn().mockResolvedValue(undefined),
    rebuildBrain: vi.fn().mockResolvedValue('rebuilt'),
    getState: vi.fn().mockReturnValue({
      engramContext: null, spiderBrainContext: null, turnCount: 0,
      lastModel: null, lastTier: null, lastAgent: null,
      usage: { total: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 } },
    }),
    contextStats: vi.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0 }),
    initialize: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const BASE_CONFIG = {
  webToken: 'test-token',
  projectPath: '/tmp/koa-test',
  model: 'claude-sonnet-4-5',
  maxTokens: 8192,
  engramEnabled: false,
  smartRouting: false,
  noCache: true,
  maxToolOutputChars: 50000,
  autoCheckpointTurns: 0,
  autoCheckpointMinutes: 0,
  autoChaining: false,
  briefingEnabled: false,
  briefingTime: '08:00',
  ttsProvider: 'say' as const,
  provider: 'anthropic' as const,
  ollamaModel: 'llama3.2',
  ollamaBaseUrl: 'http://localhost:11434',
  sandboxBackend: 'local' as const,
  sandboxTimeoutMs: 10000,
};

// ══════════════════════════════════════════════════════════════════════════════
// INVARIANT 1: Path traversal rejection in cross_repo tools
//
// Enforcement: src/agent/tools/cross_repo.ts — resolveAllowed()
// Rule: relPath containing ".." must be rejected before any filesystem access.
// ══════════════════════════════════════════════════════════════════════════════

describe('INVARIANT 1 — cross_repo: path traversal rejected before filesystem access', () => {
  // Uses vi.resetModules() so the env var is evaluated at import time (mirrors
  // how the module actually builds its allowlist at process startup).
  let tmpDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let crossRepoReadTool: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let crossRepoWriteTool: any;

  beforeEach(async () => {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    tmpDir = fs.default.mkdtempSync(path.default.join(os.default.tmpdir(), 'koa-h8-inv1-'));
    // Point allowlist to a safe temp dir so reads/writes can succeed on the happy path
    process.env['KOA_CROSS_REPO_ALLOWLIST'] = JSON.stringify({ testrepo: tmpDir });
    vi.resetModules();
    const mod = await import('../../agent/tools/cross_repo.js');
    crossRepoReadTool = mod.crossRepoReadTool;
    crossRepoWriteTool = mod.crossRepoWriteTool;
  });

  afterEach(() => {
    delete process.env['KOA_CROSS_REPO_ALLOWLIST'];
    vi.resetModules();
    const fs = require('fs');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('read: rejects "../" traversal in relPath', async () => {
    await expect(
      crossRepoReadTool.execute({ repo: 'testrepo', relPath: '../../../etc/passwd' }),
    ).rejects.toThrow('Path traversal rejected');
  });

  it('write: rejects "../" traversal in relPath', async () => {
    await expect(
      crossRepoWriteTool.execute({ repo: 'testrepo', relPath: '../../../etc/passwd', content: 'evil' }),
    ).rejects.toThrow('Path traversal rejected');
  });

  it('read: rejects unknown repo (no allowlist entry = no access)', async () => {
    await expect(
      crossRepoReadTool.execute({ repo: 'unknown-repo', relPath: 'file.txt' }),
    ).rejects.toThrow('Unknown repo');
  });

  it('write: rejects unknown repo', async () => {
    await expect(
      crossRepoWriteTool.execute({ repo: 'unknown-repo', relPath: 'file.txt', content: 'data' }),
    ).rejects.toThrow('Unknown repo');
  });

  it('happy path: legitimate read/write within allowed root succeeds', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.default.join(tmpDir, 'legitimate.txt');
    await fs.writeFile(filePath, 'safe content', 'utf-8');
    const result = await crossRepoReadTool.execute({ repo: 'testrepo', relPath: 'legitimate.txt' });
    expect(result).toBe('safe content');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INVARIANT 2: SSRF guard rejects private/loopback addresses
//
// Enforcement: src/utils/ssrf.ts — validateSafeUrl()
// Rule: private IPv4 ranges, loopback, link-local, and IPv6 equivalents must
//       all throw before any outbound HTTP request is made.
// ══════════════════════════════════════════════════════════════════════════════

describe('INVARIANT 2 — SSRF: validateSafeUrl rejects private and loopback addresses', () => {
  // Import directly — no mocking needed, pure function
  let validateSafeUrl: (url: string) => void;

  beforeEach(async () => {
    const mod = await import('../../utils/ssrf.js');
    validateSafeUrl = mod.validateSafeUrl;
  });

  it('rejects localhost', () => {
    expect(() => validateSafeUrl('https://localhost/')).toThrow(/private|loopback/i);
  });

  it('rejects 127.0.0.1 (IPv4 loopback)', () => {
    expect(() => validateSafeUrl('https://127.0.0.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 10.x.x.x (RFC-1918 Class A)', () => {
    expect(() => validateSafeUrl('https://10.0.0.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 192.168.x.x (RFC-1918 Class C)', () => {
    expect(() => validateSafeUrl('https://192.168.1.100/')).toThrow(/private|loopback/i);
  });

  it('rejects 172.16–31.x.x (RFC-1918 Class B)', () => {
    expect(() => validateSafeUrl('https://172.20.0.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 169.254.x.x (link-local / AWS metadata endpoint)', () => {
    expect(() => validateSafeUrl('https://169.254.169.254/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv6 loopback [::1]', () => {
    expect(() => validateSafeUrl('https://[::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv6 ULA [fc00::1]', () => {
    expect(() => validateSafeUrl('https://[fc00::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects http:// (non-HTTPS)', () => {
    expect(() => validateSafeUrl('http://example.com')).toThrow(/HTTPS/i);
  });

  it('allows a valid public HTTPS URL', () => {
    expect(() => validateSafeUrl('https://example.com/api')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INVARIANT 3: SSE error events do not expose stack traces or internal details
//
// Enforcement: src/server/routes/chat.ts — runChatStream() catch block
// Rule: when loop.turn() throws, the SSE stream must emit a generic error
//       message. Stack traces, file paths, and error.message from internal
//       exceptions must not appear in the event payload sent to the client.
// ══════════════════════════════════════════════════════════════════════════════

describe('INVARIANT 3 — SSE: error events do not expose internal details', () => {
  it('agent error produces a generic SSE error event, no stack trace in payload', async () => {
    const { createServer } = await import('../../server/index.js');

    // Craft an error with a recognisable internal detail that must never reach the client
    const internalError = new Error('secret path /var/app/.koa/db.sqlite and /Users/ralph brynard/active projects/koa/secret.ts at line 42');
    internalError.stack = `Error: secret path /var/app/.koa/db.sqlite and /Users/ralph brynard/active projects/koa/secret.ts at line 42\n    at AgentLoop.turn (/var/app/src/agent/loop.ts:99:9)`;

    const loop = makeFakeLoop({
      turn: vi.fn().mockRejectedValue(internalError),
    });

    const { app } = createServer(
      loop as unknown as import('../../agent/loop.js').AgentLoop,
      BASE_CONFIG as unknown as import('../../config/index.js').KoaConfig,
    );

    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'trigger error' }),
      });

      // Response opens as SSE stream (200 with text/event-stream)
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

      const body = await res.text();

      // Must contain an error event
      expect(body).toContain('"type":"error"');

      // Must NOT leak the internal error details
      expect(body).not.toContain('/var/app');
      expect(body).not.toContain('db.sqlite');
      expect(body).not.toContain('AgentLoop');
      expect(body).not.toContain('loop.ts');

      // Must also strip paths that have spaces in components
      expect(body).not.toContain('brynard/active');

      // The error message should be the generic one from chat.ts
      expect(body).toContain('Agent error');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// INVARIANT 4: 429 returned when a second request arrives while agent is busy
//
// Enforcement: src/server/routes/chat.ts — isBusy guard in POST /api/chat
//              and GET /api/sse/chat
// Rule: concurrent requests beyond one active turn are rejected with HTTP 429,
//       not queued, to prevent resource exhaustion.
//
// Note: POST /api/chat → 429 busy is covered in server_routes.test.ts.
//       This suite covers the GET /api/sse/chat variant, which has its own
//       isBusy check and is the primary mobile/iOS path.
// ══════════════════════════════════════════════════════════════════════════════

describe('INVARIANT 4 — rate-limit: concurrent requests above one active turn get 429', () => {
  it('GET /api/sse/chat: second request while first is in-flight → 429', async () => {
    const { createServer } = await import('../../server/index.js');

    let resolveFirst!: (v: TurnResult) => void;
    const firstTurnPromise = new Promise<TurnResult>((r) => { resolveFirst = r; });
    const mockResult: TurnResult = {
      content: 'hello',
      toolUses: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-5',
      tier: 'sonnet',
      agent: 'code-assistant',
      usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, model: 'test', agent: 'code-assistant' as const },
    };

    const loop = makeFakeLoop({
      turn: vi.fn()
        .mockImplementationOnce(() => firstTurnPromise)
        .mockResolvedValue(mockResult),
    });

    const { app } = createServer(
      loop as unknown as import('../../agent/loop.js').AgentLoop,
      BASE_CONFIG as unknown as import('../../config/index.js').KoaConfig,
    );

    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const authHeader = 'Bearer test-token';

    try {
      // Start the first SSE turn — turn() will hang until resolveFirst()
      const firstReqAbort = new AbortController();
      const firstFetch = fetch(
        `http://localhost:${port}/api/sse/chat?message=first`,
        { headers: { Authorization: authHeader }, signal: firstReqAbort.signal },
      );

      // Wait briefly for isBusy to be set true
      await new Promise((r) => setTimeout(r, 30));

      // Second request should see isBusy=true → 429
      const secondRes = await fetch(
        `http://localhost:${port}/api/sse/chat?message=second`,
        { headers: { Authorization: authHeader } },
      );
      expect(secondRes.status).toBe(429);
      const body = await secondRes.json() as { error: string };
      expect(body.error).toMatch(/busy/i);

      // Resolve the first turn so the test can clean up without timeout
      resolveFirst(mockResult);
      try { await firstFetch; } catch { /* aborted — expected */ }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 10000);

  it('POST /api/chat: 429 error body does not expose internal state', async () => {
    // Verifies the 429 response itself is safe (complements server_routes.test.ts which
    // only checks the status code).
    const { createServer } = await import('../../server/index.js');

    let resolveFirst!: (v: TurnResult) => void;
    const firstTurnPromise = new Promise<TurnResult>((r) => { resolveFirst = r; });
    const mockResult: TurnResult = {
      content: 'hello',
      toolUses: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-5',
      tier: 'sonnet',
      agent: 'code-assistant',
      usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, model: 'test', agent: 'code-assistant' as const },
    };

    const loop = makeFakeLoop({
      turn: vi.fn()
        .mockImplementationOnce(() => firstTurnPromise)
        .mockResolvedValue(mockResult),
    });

    const { app } = createServer(
      loop as unknown as import('../../agent/loop.js').AgentLoop,
      BASE_CONFIG as unknown as import('../../config/index.js').KoaConfig,
    );

    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const firstReqAbort = new AbortController();
      const firstFetch = fetch(`http://localhost:${port}/api/chat`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
        signal: firstReqAbort.signal,
      });

      await new Promise((r) => setTimeout(r, 30));

      const secondRes = await fetch(`http://localhost:${port}/api/chat`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello again' }),
      });

      expect(secondRes.status).toBe(429);
      const body = await secondRes.json() as { error: string };

      // Error message must be user-facing only — no internal paths, models, or stack info
      expect(body).toHaveProperty('error');
      expect(Object.keys(body)).toEqual(['error']); // exactly one field, no 'stack', 'trace', etc.
      expect(body.error).not.toMatch(/\/home\//);
      expect(body.error).not.toMatch(/\.ts:/);

      resolveFirst(mockResult);
      try { await firstFetch; } catch { /* ignored */ }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 10000);
});
