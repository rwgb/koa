/**
 * oauth-csrf.test.ts — Integration tests for GAP-01
 *
 * Tests the OAuth CSRF nonce validation in the Gmail and Google Calendar
 * callback handlers (createOAuthCallbackRouter). Covers all failure branches
 * that had 0% coverage:
 *   - missing nonce in state param
 *   - replayed nonce (one-time use enforcement)
 *   - token exchange failure (graceful error, not 500)
 *   - happy path (tokens persisted, success redirect)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';
import type { OAuthStateMap } from '../server/routes/admin.js';
import type * as GmailModule from '../channels/gmail.js';
import type * as CalOAuthModule from '../calendar/oauth.js';

// ── Mock all external side-effect modules ─────────────────────────────────────

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
      scope: 'https://mail.google.com/',
    }),
  };
});

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
  };
});

vi.mock('../calendar/sync.js', () => ({
  calendarSync: { start: vi.fn(), stop: vi.fn(), syncNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn().mockReturnValue([]),
  saveIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  maskSecrets: vi.fn((x: unknown) => x),
  mergeConfig: vi.fn(),
  ALLOWED_TYPES: new Set(['gmail', 'google-calendar', 'slack']),
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with just the OAuth callback router mounted.
 * Returns both the app and the oauthState map so tests can seed nonces.
 */
async function buildOAuthApp(): Promise<{ app: Express; oauthState: OAuthStateMap }> {
  const { createOAuthCallbackRouter } = await import('../server/routes/admin.js');
  const config = {
    publicUrl: undefined,
    apiKey: undefined,
  } as unknown as import('../config/index.js').KoaConfig;

  const oauthState: OAuthStateMap = new Map();
  const router = createOAuthCallbackRouter(config, oauthState);

  const app = express();
  app.use('/api/admin', router);
  return { app, oauthState };
}

/** Mint a valid-looking 64-char hex nonce and register it in the map. */
function seedNonce(
  oauthState: OAuthStateMap,
  integrationId: string,
): string {
  const nonce = 'a'.repeat(64); // deterministic for tests
  oauthState.set(nonce, { ts: Date.now(), integrationId });
  return nonce;
}

/** Mint a unique nonce (avoids collision across tests that call seedNonce twice). */
function seedUniqueNonce(
  oauthState: OAuthStateMap,
  integrationId: string,
  prefix: string,
): string {
  const nonce = prefix.padEnd(64, '0').slice(0, 64);
  oauthState.set(nonce, { ts: Date.now(), integrationId });
  return nonce;
}

// ── beforeEach / afterEach ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Gmail callback — missing nonce ────────────────────────────────────────────

describe('Gmail OAuth callback — missing / invalid nonce', () => {
  it('redirects to ?error=oauth_failed when state param is absent', async () => {
    const { app } = await buildOAuthApp();
    const res = await request(app)
      .get('/api/admin/oauth/gmail/callback?code=authcode123');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
  });

  it('redirects to ?error=oauth_failed when state is present but not in oauthState map', async () => {
    const { app } = await buildOAuthApp();
    const res = await request(app)
      .get('/api/admin/oauth/gmail/callback?code=authcode123&state=deadbeef'.padEnd(
        '/api/admin/oauth/gmail/callback?code=authcode123&state='.length + 64,
        'f',
      ));
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
  });

  it('does not call exchangeCodeForTokens when nonce is missing', async () => {
    const { exchangeCodeForTokens } = await import('../channels/gmail.js');
    const { app } = await buildOAuthApp();
    await request(app)
      .get('/api/admin/oauth/gmail/callback?code=authcode123');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('redirects to ?error=oauth_failed when Google sends an error param (no code)', async () => {
    const { app } = await buildOAuthApp();
    const res = await request(app)
      .get('/api/admin/oauth/gmail/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
  });
});

// ── Gmail callback — replayed nonce ───────────────────────────────────────────

describe('Gmail OAuth callback — replayed nonce (one-time use)', () => {
  it('accepts the first request then rejects the second with the same nonce', async () => {
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedNonce(oauthState, 'gmail');

    const first = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=code1&state=${nonce}`);
    expect(first.status).toBe(302);
    expect(first.headers['location']).toContain('connected=gmail');

    // Nonce was consumed — second request must fail
    const second = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=code2&state=${nonce}`);
    expect(second.status).toBe(302);
    expect(second.headers['location']).toContain('error=oauth_failed');
  });

  it('nonce is deleted from the map after first use', async () => {
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'gmail', 'deadbeef');

    await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=c1&state=${nonce}`);

    expect(oauthState.has(nonce)).toBe(false);
  });
});

// ── Gmail callback — token exchange failure ────────────────────────────────────

describe('Gmail OAuth callback — token exchange failure', () => {
  it('redirects to ?error=oauth_failed (not 500) when exchangeCodeForTokens throws', async () => {
    const { exchangeCodeForTokens } = await import('../channels/gmail.js');
    vi.mocked(exchangeCodeForTokens).mockRejectedValueOnce(new Error('network error'));

    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'gmail', 'abcdef1234');

    const res = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=badcode&state=${nonce}`);

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
    // Must not be a 500 (unhandled)
    expect(res.status).not.toBe(500);
  });

  it('exchange failure does not persist any integration', async () => {
    const { exchangeCodeForTokens } = await import('../channels/gmail.js');
    const { saveIntegration } = await import('../integrations/store.js');
    vi.mocked(exchangeCodeForTokens).mockRejectedValueOnce(new Error('token exchange failed'));

    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'gmail', 'failure00001');

    await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=badcode&state=${nonce}`);

    expect(saveIntegration).not.toHaveBeenCalled();
  });
});

// ── Gmail callback — happy path ────────────────────────────────────────────────

describe('Gmail OAuth callback — happy path', () => {
  it('redirects to /integrations?connected=gmail on success', async () => {
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'gmail', 'happygmail00');

    const res = await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=validcode&state=${nonce}`);

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/integrations?connected=gmail');
  });

  it('persists integration with refresh token on success', async () => {
    const { saveIntegration } = await import('../integrations/store.js');
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'gmail', 'happysave001');

    await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=validcode&state=${nonce}`);

    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gmail',
        status: 'connected',
        config: expect.objectContaining({ refreshToken: 'test-refresh' }),
      }),
    );
  });

  it('uses integrationId from the nonce entry', async () => {
    const { saveIntegration } = await import('../integrations/store.js');
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'gmail-secondary', 'customid0001');

    await request(app)
      .get(`/api/admin/oauth/gmail/callback?code=validcode&state=${nonce}`);

    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gmail-secondary' }),
    );
  });
});

// ── Calendar callback — missing nonce ────────────────────────────────────────

describe('Google Calendar OAuth callback — missing / invalid nonce', () => {
  it('redirects to ?error=oauth_failed when state param is absent', async () => {
    const { app } = await buildOAuthApp();
    const res = await request(app)
      .get('/api/admin/oauth/calendar/callback?code=calcode123');
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
  });

  it('redirects to ?error=oauth_failed when state is not in oauthState map', async () => {
    const { app } = await buildOAuthApp();
    const res = await request(app)
      .get('/api/admin/oauth/calendar/callback?code=calcode123&state=' + 'b'.repeat(64));
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
  });

  it('does not call exchangeCalendarCode when nonce is missing', async () => {
    const { exchangeCalendarCode } = await import('../calendar/oauth.js');
    const { app } = await buildOAuthApp();
    await request(app)
      .get('/api/admin/oauth/calendar/callback?code=calcode123');
    expect(exchangeCalendarCode).not.toHaveBeenCalled();
  });
});

// ── Calendar callback — replayed nonce ───────────────────────────────────────

describe('Google Calendar OAuth callback — replayed nonce', () => {
  it('accepts the first request then rejects the second with the same nonce', async () => {
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'google-calendar', 'calreplay001');

    const first = await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=calcode1&state=${nonce}`);
    expect(first.status).toBe(302);
    expect(first.headers['location']).toContain('connected=google-calendar');

    const second = await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=calcode2&state=${nonce}`);
    expect(second.status).toBe(302);
    expect(second.headers['location']).toContain('error=oauth_failed');
  });
});

// ── Calendar callback — token exchange failure ─────────────────────────────────

describe('Google Calendar OAuth callback — token exchange failure', () => {
  it('redirects to ?error=oauth_failed (not 500) when exchangeCalendarCode throws', async () => {
    const { exchangeCalendarCode } = await import('../calendar/oauth.js');
    vi.mocked(exchangeCalendarCode).mockRejectedValueOnce(new Error('calendar exchange failed'));

    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'google-calendar', 'calerror0001');

    const res = await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=badcalcode&state=${nonce}`);

    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('error=oauth_failed');
    expect(res.status).not.toBe(500);
  });

  it('exchange failure does not persist any integration', async () => {
    const { exchangeCalendarCode } = await import('../calendar/oauth.js');
    const { saveIntegration } = await import('../integrations/store.js');
    vi.mocked(exchangeCalendarCode).mockRejectedValueOnce(new Error('failure'));

    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'google-calendar', 'calnosave01');

    await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=badcalcode&state=${nonce}`);

    expect(saveIntegration).not.toHaveBeenCalled();
  });
});

// ── Calendar callback — happy path ────────────────────────────────────────────

describe('Google Calendar OAuth callback — happy path', () => {
  it('redirects to /integrations?connected=google-calendar on success', async () => {
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'google-calendar', 'calhappy0001');

    const res = await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=validcalcode&state=${nonce}`);

    expect(res.status).toBe(302);
    expect(res.headers['location']).toBe('/integrations?connected=google-calendar');
  });

  it('persists integration with refresh token on success', async () => {
    const { saveIntegration } = await import('../integrations/store.js');
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'google-calendar', 'calsave00001');

    await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=validcalcode&state=${nonce}`);

    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'google-calendar',
        status: 'connected',
        config: expect.objectContaining({ refreshToken: 'cal-refresh' }),
      }),
    );
  });

  it('uses integrationId from the nonce entry for calendar', async () => {
    const { saveIntegration } = await import('../integrations/store.js');
    const { app, oauthState } = await buildOAuthApp();
    const nonce = seedUniqueNonce(oauthState, 'work-calendar', 'calid000001');

    await request(app)
      .get(`/api/admin/oauth/calendar/callback?code=validcalcode&state=${nonce}`);

    expect(saveIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'work-calendar' }),
    );
  });
});
