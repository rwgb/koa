/**
 * server_routes.test.ts — HTTP route integration tests for §B fixes.
 *
 * Uses supertest against createServer(). Avoids real background-service
 * side-effects by mocking the poller/sync modules before importing the server.
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { TurnResult } from '../types/index.js';
import type { KoaConfig } from '../config/index.js';
import type { AgentLoop } from '../agent/loop.js';
import type * as GmailModule from '../channels/gmail.js';
import type * as CalOAuthModule from '../calendar/oauth.js';
import type * as MiddlewareModule from '../server/middleware.js';

// ── Mock background service modules so createServer() doesn't start real pollers ──
vi.mock('../channels/gmail.js', async (importOriginal) => {
  const actual = await importOriginal<typeof GmailModule>();
  return {
    ...actual,
    gmailPoller: { start: vi.fn(), stop: vi.fn() },
    generateOAuthUrl: vi.fn((redirectUri: string, state?: string) =>
      `https://accounts.google.com/o/oauth2/auth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state ?? ''}`
    ),
    exchangeCodeForTokens: vi.fn().mockResolvedValue({
      refresh_token: 'test-refresh',
      access_token: 'test-access',
    }),
    extractIntent: vi.fn().mockResolvedValue({ type: 'unknown', content: 'x' }),
  };
});

vi.mock('../calendar/sync.js', () => ({
  calendarSync: { start: vi.fn(), stop: vi.fn(), syncNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../calendar/oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CalOAuthModule>();
  return {
    ...actual,
    generateCalendarOAuthUrl: vi.fn((redirectUri: string, state?: string) =>
      `https://accounts.google.com/o/oauth2/cal?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state ?? ''}`
    ),
    exchangeCalendarCode: vi.fn().mockResolvedValue({
      refresh_token: 'cal-refresh',
      access_token: 'cal-access',
    }),
    isCalendarConfigured: vi.fn().mockReturnValue(false),
  };
});

vi.mock('../notifications/escalation.js', () => ({
  escalationScheduler: { start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../channels/telegram.js', () => ({
  TelegramPoller: class { start = vi.fn(); stop = vi.fn(); },
}));

vi.mock('../channels/router.js', () => ({
  setTelegramPoller: vi.fn(),
  routeResponse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../config/credentials.js', () => ({
  readCredentials: vi.fn().mockReturnValue({ OPENAI_API_KEY: 'test-key' }),
  writeCredential: vi.fn(),
  deleteCredential: vi.fn(),
  getCredentialsPath: vi.fn().mockReturnValue('/tmp/koa-test-creds'),
}));

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn().mockReturnValue([]),
  saveIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  maskSecrets: vi.fn((x: unknown) => x),
  mergeConfig: vi.fn(),
  ALLOWED_TYPES: ['gmail', 'google-calendar', 'slack', 'twilio'],
}));

vi.mock('../voice/whisper.js', () => ({
  transcribeAudio: vi.fn().mockResolvedValue('test transcription'),
}));

vi.mock('../voice/tts.js', () => ({
  synthesizeStream: vi.fn().mockResolvedValue({ stream: null, contentType: 'audio/mpeg' }),
  cleanText: (t: string) => t.replace(/[*_`#>]/g, '').slice(0, 500),
}));

vi.mock('../proactive/briefing.js', () => ({
  buildDailyBriefing: vi.fn().mockResolvedValue('briefing'),
}));

vi.mock('../proactive/delegations.js', () => ({
  runDueDelegations: vi.fn().mockResolvedValue(undefined),
}));

// Bypass the adminUpdateRateLimit (max:2 / 10 min) so admin config tests don't
// get 429 when multiple PUT /config calls happen within the same test run.
vi.mock('../server/middleware.js', async (importOriginal) => {
  const actual = await importOriginal<typeof MiddlewareModule>();
  return {
    ...actual,
    adminUpdateRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock('../db/index.js', () => ({
  listConversations: vi.fn().mockReturnValue([]),
  getConversation: vi.fn().mockReturnValue(null),
  getConversationTurns: vi.fn().mockReturnValue([]),
  searchConversations: vi.fn().mockReturnValue([]),
  deleteConversationsBefore: vi.fn().mockReturnValue(0),
  createConversation: vi.fn().mockReturnValue({ id: 'test-conv-id', title: null, started_at: new Date().toISOString(), ended_at: null, turn_count: 0 }),
  addConversationTurn: vi.fn().mockReturnValue({ id: 'test-turn-id' }),
  createDelegation: vi.fn().mockReturnValue({ id: 'test-del-id' }),
  listDelegations: vi.fn().mockReturnValue([]),
  getDelegation: vi.fn().mockReturnValue(null),
  updateDelegation: vi.fn().mockReturnValue(null),
  deleteDelegation: vi.fn().mockReturnValue(0),
}));

// ── Fake AgentLoop ──────────────────────────────────────────────────────────────

function makeFakeLoop(overrides: Partial<{
  turn: () => Promise<TurnResult>;
  checkpoint: () => Promise<void>;
  rebuildBrain: () => Promise<string>;
  getState: () => object;
  getConversationId: () => string | null;
  contextStats: () => object;
  initialize: () => Promise<void>;
  finalize: () => Promise<void>;
  updateApiKey: (key: string) => void;
}> = {}) {
  const defaultUsage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, model: 'test', agent: 'code-assistant' as const };
  const defaultResult: TurnResult = {
    content: 'hello',
    toolUses: [],
    stopReason: 'end_turn',
    model: 'claude-sonnet-4-5',
    tier: 'sonnet',
    agent: 'code-assistant',
    usage: defaultUsage,
  };
  return {
    turn: vi.fn().mockResolvedValue(defaultResult),
    checkpoint: vi.fn().mockResolvedValue(undefined),
    rebuildBrain: vi.fn().mockResolvedValue('rebuilt'),
    getState: vi.fn().mockReturnValue({
      engramContext: null,
      spiderBrainContext: null,
      turnCount: 0,
      lastModel: null,
      lastTier: null,
      lastAgent: null,
      usage: { total: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 } },
    }),
    getConversationId: vi.fn().mockReturnValue(null),
    contextStats: vi.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0 }),
    initialize: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
    updateApiKey: vi.fn(),
    ...overrides,
  };
}

// ── Build app helper ────────────────────────────────────────────────────────────

async function buildApp(
  token: string | undefined,
  loopOverrides: Parameters<typeof makeFakeLoop>[0] = {},
): Promise<Express> {
  const { createServer } = await import('../server/index.js');
  const config = {
    webToken: token,
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
  } as unknown as KoaConfig;

  const loop = makeFakeLoop(loopOverrides);
  const { app } = createServer(loop as unknown as AgentLoop, config);
  return app;
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe('§B server routes — auth matrix', () => {
  it('GET /api/ping returns 200 with no auth (always accessible)', async () => {
    const app = await buildApp(undefined);
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/context with no token configured → 403', async () => {
    const app = await buildApp(undefined);
    const res = await request(app).get('/api/context');
    expect(res.status).toBe(403);
  });

  it('POST /api/auth with no token configured → 503', async () => {
    const app = await buildApp(undefined);
    const res = await request(app).post('/api/auth').send({ token: 'any' });
    expect(res.status).toBe(503);
  });

  it('GET /api/context with token set but no header → 401', async () => {
    const app = await buildApp('mysecrettoken');
    const res = await request(app).get('/api/context');
    expect(res.status).toBe(401);
  });

  it('GET /api/context with wrong Bearer → 401', async () => {
    const app = await buildApp('mysecrettoken');
    const res = await request(app).get('/api/context').set('Authorization', 'Bearer wrongtoken');
    expect(res.status).toBe(401);
  });

  it('GET /api/context with correct Bearer → 200', async () => {
    const app = await buildApp('mysecrettoken');
    const res = await request(app).get('/api/context').set('Authorization', 'Bearer mysecrettoken');
    expect(res.status).toBe(200);
  });

  it('POST /api/auth with correct token → 200 ok:true', async () => {
    const app = await buildApp('mytoken');
    const res = await request(app).post('/api/auth').send({ token: 'mytoken' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/auth with wrong token → 401', async () => {
    const app = await buildApp('mytoken');
    const res = await request(app).post('/api/auth').send({ token: 'wrongtoken' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/context — conversationId exposure', () => {
  it('returns conversationId: null before the first turn (lazy creation)', async () => {
    const app = await buildApp('tok');
    const res = await request(app).get('/api/context').set('Authorization', 'Bearer tok');
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBeNull();
  });

  it('returns the active conversation id once one exists', async () => {
    const app = await buildApp('tok', { getConversationId: () => 'conv-42' });
    const res = await request(app).get('/api/context').set('Authorization', 'Bearer tok');
    expect(res.status).toBe(200);
    expect(res.body.conversationId).toBe('conv-42');
  });
});

describe('§B server routes — OAuth state CSRF', () => {
  it('GET /api/admin/oauth/gmail (valid bearer) issues a 64-char hex state in the URL', async () => {
    const { generateOAuthUrl } = await import('../channels/gmail.js');
    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/admin/oauth/gmail')
      .set('Authorization', 'Bearer tok');
    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    // The mock captures state= from the URL
    const url = res.body.url as string;
    const match = /state=([a-f0-9]+)/.exec(url);
    expect(match).not.toBeNull();
    expect(match![1]).toHaveLength(64); // 32 bytes = 64 hex chars
    expect(generateOAuthUrl).toHaveBeenCalled();
  });

  it('OAuth gmail callback with valid state → 302 to ?connected=gmail', async () => {
    // Step 1: get a valid state nonce via the URL builder
    const app = await buildApp('tok');
    const urlRes = await request(app)
      .get('/api/admin/oauth/gmail')
      .set('Authorization', 'Bearer tok');
    const url = urlRes.body.url as string;
    const match = /state=([a-f0-9]+)/.exec(url);
    const state = match![1];

    // Step 2: simulate Google redirect back with that state
    const cbRes = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=authcode123&state=${state}`);
    expect(cbRes.status).toBe(302);
    expect(cbRes.headers['location']).toContain('connected=gmail');
  });

  it('OAuth gmail callback with bogus state → 302 ?error=oauth_failed, exchange NOT called', async () => {
    const { exchangeCodeForTokens } = await import('../channels/gmail.js');
    vi.mocked(exchangeCodeForTokens).mockClear();
    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/admin/oauth/gmail/callback?code=authcode123&state=badbadbadbad');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('OAuth gmail callback replay (second use of same state) → fails', async () => {
    const app = await buildApp('tok');
    const urlRes = await request(app)
      .get('/api/admin/oauth/gmail')
      .set('Authorization', 'Bearer tok');
    const url = urlRes.body.url as string;
    const match = /state=([a-f0-9]+)/.exec(url);
    const state = match![1];

    // First use should succeed
    const first = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=code1&state=${state}`);
    expect(first.status).toBe(302);
    expect(first.headers['location']).toContain('connected=gmail');

    // Second use with same state should fail (nonce consumed)
    const second = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=code2&state=${state}`);
    expect(second.status).toBe(302);
    expect(second.headers['location']).toContain('error=oauth_failed');
  });

  it('OAuth gmail callback with error=access_denied → 302 ?error=oauth_failed', async () => {
    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/admin/oauth/gmail/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
  });

  it('OAuth callback with no auth header reaches handler (not 401d by requireAuth)', async () => {
    // Callback paths must bypass requireAuth — they arrive from Google with no bearer token
    const app = await buildApp('tok');
    // Even without auth, should get 302 (either success redirect or error redirect)
    // Not 401/403, which requireAuth would return
    const res = await request(app)
      .get('/api/admin/oauth/gmail/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('GET /api/admin/oauth/gmail without token → 401', async () => {
    const app = await buildApp('tok');
    const res = await request(app).get('/api/admin/oauth/gmail');
    // The URL builder is behind requireAuth — no Bearer → 401
    expect([401, 403]).toContain(res.status);
  });
});

describe('§B server routes — error scrubbing', () => {
  it('POST /api/checkpoint rejecting with path leak returns generic 500', async () => {
    const { createServer } = await import('../server/index.js');
    const config = {
      webToken: 'tok',
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
    } as unknown as KoaConfig;

    const loop = makeFakeLoop({
      checkpoint: vi.fn().mockRejectedValue(new Error('secret path /etc/shadow exposed')),
    });
    const { app } = createServer(loop as unknown as AgentLoop, config);

    const res = await request(app)
      .post('/api/checkpoint')
      .set('Authorization', 'Bearer tok');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret path');
  });

  it('POST /api/admin/brain/rebuild rejecting → 500 generic', async () => {
    const { createServer } = await import('../server/index.js');
    const config = {
      webToken: 'tok',
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
    } as unknown as KoaConfig;

    const loop = makeFakeLoop({
      rebuildBrain: vi.fn().mockRejectedValue(new Error('internal db path /home/user/.koa/db.sqlite')),
    });
    const { app } = createServer(loop as unknown as AgentLoop, config);

    const res = await request(app)
      .post('/api/admin/brain/rebuild')
      .set('Authorization', 'Bearer tok');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('POST /api/voice/transcribe non-Whisper error → 500 generic', async () => {
    const { transcribeAudio } = await import('../voice/whisper.js');
    vi.mocked(transcribeAudio).mockRejectedValueOnce(new Error('internal path /etc/hosts'));

    const app = await buildApp('tok');
    const res = await request(app)
      .post('/api/voice/transcribe')
      .set('Authorization', 'Bearer tok')
      .set('Content-Type', 'audio/wav')
      .send(Buffer.alloc(1000));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('/etc/hosts');
  });

  it('POST /api/voice/transcribe Whisper error → 502 with preserved message', async () => {
    const { transcribeAudio } = await import('../voice/whisper.js');
    vi.mocked(transcribeAudio).mockRejectedValueOnce(
      new Error('Whisper API returned an error: 400 bad audio')
    );

    const app = await buildApp('tok');
    const res = await request(app)
      .post('/api/voice/transcribe')
      .set('Authorization', 'Bearer tok')
      .set('Content-Type', 'audio/wav')
      .send(Buffer.alloc(1000));
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Whisper API returned an error');
  });
});

describe('TTS endpoints', () => {
  it('GET /api/voice/tts-status returns { available: false } when ELEVENLABS_API_KEY not in credentials', async () => {
    const { readCredentials } = await import('../config/credentials.js');
    // createServer() calls readCredentials() once at startup (for Telegram token check).
    // Queue two values: one for startup, one for the route handler.
    vi.mocked(readCredentials).mockReturnValueOnce({}).mockReturnValueOnce({});

    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/voice/tts-status')
      .set('Authorization', 'Bearer tok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it('GET /api/voice/tts-status returns { available: true } when ELEVENLABS_API_KEY is in credentials', async () => {
    const { readCredentials } = await import('../config/credentials.js');
    // First call is startup (no Telegram), second call is the route handler.
    vi.mocked(readCredentials).mockReturnValueOnce({}).mockReturnValueOnce({ ELEVENLABS_API_KEY: 'el-test-key' });

    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/voice/tts-status')
      .set('Authorization', 'Bearer tok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it('POST /api/voice/tts returns 400 when text is missing', async () => {
    const app = await buildApp('tok');
    const res = await request(app)
      .post('/api/voice/tts')
      .set('Authorization', 'Bearer tok')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('non-empty');
  });

  it('POST /api/voice/tts returns 400 when text is empty string', async () => {
    const app = await buildApp('tok');
    const res = await request(app)
      .post('/api/voice/tts')
      .set('Authorization', 'Bearer tok')
      .send({ text: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('non-empty');
  });

  it('POST /api/voice/tts returns 503 when ELEVENLABS_API_KEY not configured', async () => {
    const { synthesizeStream } = await import('../voice/tts.js');
    vi.mocked(synthesizeStream).mockRejectedValueOnce(
      new Error('ELEVENLABS_API_KEY not configured')
    );

    const app = await buildApp('tok');
    const res = await request(app)
      .post('/api/voice/tts')
      .set('Authorization', 'Bearer tok')
      .send({ text: 'hello' });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('ElevenLabs not configured');
  });

  it('POST /api/voice/tts streams audio/mpeg when configured', async () => {
    const { synthesizeStream } = await import('../voice/tts.js');
    const { Readable } = await import('stream');

    const fakeAudio = Buffer.from('fake-mp3-data');
    const fakeStream = Readable.from([fakeAudio]);
    vi.mocked(synthesizeStream).mockResolvedValueOnce({
      stream: fakeStream,
      contentType: 'audio/mpeg',
    });

    const app = await buildApp('tok');
    const res = await request(app)
      .post('/api/voice/tts')
      .set('Authorization', 'Bearer tok')
      .send({ text: 'hello world' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/mpeg');
    expect(res.body).toBeDefined();
  });
});

describe('pruneExpiredNonces', () => {
  it('removes nonces older than ttlMs and keeps fresh ones', async () => {
    const { pruneExpiredNonces } = await import('../server/index.js');
    const map: Map<string, { ts: number; integrationId: string }> = new Map();
    const oldNonce = 'old-nonce-aabbcc';
    const freshNonce = 'fresh-nonce-ddeeff';
    map.set(oldNonce, { ts: Date.now() - 11 * 60_000, integrationId: 'gmail' });
    map.set(freshNonce, { ts: Date.now() - 1 * 60_000, integrationId: 'gmail' });

    pruneExpiredNonces(map, 10 * 60_000);

    expect(map.has(oldNonce)).toBe(false);
    expect(map.has(freshNonce)).toBe(true);
  });
});

describe('§B server routes — SSE busy/auth', () => {
  // Behavior changed: requests now queue via TurnScheduler instead of returning 429.
  // A second POST /api/chat while the first is running is enqueued and will be
  // processed after the first turn completes — no 429 is returned.
  it('POST /api/chat when busy → queues second request (no 429)', async () => {
    const { createServer } = await import('../server/index.js');
    const config = {
      webToken: 'tok',
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
    } as unknown as KoaConfig;

    let resolveFirst!: (v: TurnResult) => void;
    const firstTurnPromise = new Promise<TurnResult>(r => { resolveFirst = r; });
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
      turn: vi.fn().mockImplementationOnce(() => firstTurnPromise)
                   .mockResolvedValue(mockResult),
    });
    const { app } = createServer(loop as unknown as AgentLoop, config);

    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    // Send first request — scheduler is running, turn() pauses
    const firstFetch = fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    // Wait briefly for the first turn to be running
    await new Promise(r => setTimeout(r, 30));

    // Second request should be accepted and queued — not 429
    // We resolve first immediately so the second can also complete
    resolveFirst(mockResult);
    const secondFetch = fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello again' }),
    });

    const [res1, res2] = await Promise.all([firstFetch, secondFetch]);

    // Both requests should succeed (200 SSE), not 429
    expect(res1.status).not.toBe(429);
    expect(res2.status).not.toBe(429);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    await new Promise<void>(r => server.close(() => r()));
  }, 10000);

  it('GET /api/sse/chat with empty message → 400', async () => {
    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/sse/chat?message=')
      .set('Authorization', 'Bearer tok');
    expect(res.status).toBe(400);
  });

  it('GET /api/sse/chat with no auth → 401/403', async () => {
    const app = await buildApp('tok');
    const res = await request(app).get('/api/sse/chat?message=hello');
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/sse/chat with valid ?token= query param → passes auth check', async () => {
    const app = await buildApp('tok');
    // We expect either 200 (SSE stream starts) or that it doesn't return 401/403
    // The turn() mock resolves immediately, so we get the done event then end
    const res = await request(app)
      .get('/api/sse/chat?message=hello&token=tok');
    expect([200, 400]).toContain(res.status);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('GET /api/sse/chat with wrong ?token= query param → 401', async () => {
    const app = await buildApp('tok');
    const res = await request(app).get('/api/sse/chat?message=hello&token=wrongtoken');
    expect(res.status).toBe(401);
  });
});

// ── GAP-09: Conversations export and search routes ──────────────────────────

describe('GAP-09 conversations — export and search routes', () => {
  it('GET /api/conversations/:id/export returns 200 with Content-Disposition attachment for valid id', async () => {
    const { getConversation, getConversationTurns } = await import('../db/index.js');
    vi.mocked(getConversation).mockReturnValueOnce({
      id: 'conv-abc123',
      title: 'Test Conversation',
      started_at: '2026-01-01T00:00:00Z',
      ended_at: null,
      turn_count: 1,
      project_id: null,
    });
    vi.mocked(getConversationTurns).mockReturnValueOnce([]);

    const app = await buildApp('tok');
    // The JSON export path (default) doesn't set Content-Disposition; use ?format=markdown
    const res = await request(app)
      .get('/api/conversations/conv-abc123/export?format=markdown')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('GET /api/conversations/:id/export returns 404 for unknown conversation id', async () => {
    const { getConversation } = await import('../db/index.js');
    vi.mocked(getConversation).mockReturnValueOnce(null);

    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/conversations/nonexistent-id/export')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('GET /api/conversations/search with empty q returns 400', async () => {
    const app = await buildApp('tok');
    const res = await request(app)
      .get('/api/conversations/search?q=')
      .set('Authorization', 'Bearer tok');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('q parameter required');
  });
});

// ── GAP-10: PUT /api/admin/config credential-write paths ────────────────────

describe('GAP-10 PUT /api/admin/config', () => {
  it('valid apiKey triggers loop.updateApiKey()', async () => {
    const updateApiKey = vi.fn();
    const app = await buildApp('tok', { updateApiKey });

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', 'Bearer tok')
      .send({ apiKey: 'sk-ant-api-validkey123' });

    expect(res.status).toBe(200);
    expect(updateApiKey).toHaveBeenCalledWith('sk-ant-api-validkey123');
  });

  it('braveApiKey longer than 256 chars returns 400', async () => {
    const app = await buildApp('tok');
    const longKey = 'x'.repeat(257);

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', 'Bearer tok')
      .send({ braveApiKey: longKey });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/braveApiKey too long/i);
  });

  it('invalid briefingTime format (not HH:MM) returns 400', async () => {
    const app = await buildApp('tok');

    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', 'Bearer tok')
      .send({ briefingTime: '8:00am' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/briefingTime must be HH:MM/i);
  });

  it('SSRF-blocked ollamaBaseUrl (public IP not in RFC1918) returns 400', async () => {
    const app = await buildApp('tok');

    // isOllamaUrl only allows loopback + RFC1918 ranges; a public IP must be rejected
    const res = await request(app)
      .put('/api/admin/config')
      .set('Authorization', 'Bearer tok')
      .send({ ollamaBaseUrl: 'http://8.8.8.8/api' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/private\/local address/i);
  });
});
