import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockGetAccessToken = vi.fn();
const mockSetCredentials = vi.fn();

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn(),
}));

vi.mock('googleapis', () => {
  const OAuth2 = vi.fn(function (this: Record<string, unknown>) {
    this['setCredentials'] = mockSetCredentials;
    this['getAccessToken'] = mockGetAccessToken;
    this['generateAuthUrl'] = vi.fn(() => 'https://accounts.google.com/o/oauth2/auth?fake=1');
    this['getToken'] = vi.fn();
  });

  return {
    google: {
      auth: { OAuth2 },
    },
  };
});

import { getCalendarAccessToken } from '../calendar/oauth.js';
import { loadIntegrations } from '../integrations/store.js';

const mockLoadIntegrations = vi.mocked(loadIntegrations);

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCalendarIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gcal-1',
    type: 'google-calendar',
    name: 'Google Calendar',
    status: 'connected' as const,
    config: {
      clientId: 'fake-client-id',
      clientSecret: 'fake-client-secret',
      refreshToken: 'fake-refresh-token',
    },
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCalendarAccessToken', () => {
  describe('when no matching integration is found', () => {
    it('throws when the integration store is empty', async () => {
      mockLoadIntegrations.mockReturnValue([]);

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Google Calendar integration not configured',
      );
    });

    it('throws when a specific integrationId is provided but does not exist', async () => {
      mockLoadIntegrations.mockReturnValue([makeCalendarIntegration()]);

      await expect(getCalendarAccessToken('nonexistent-id')).rejects.toThrow(
        'Google Calendar integration not configured',
      );
    });

    it('throws when integrations exist but none are google-calendar type', async () => {
      mockLoadIntegrations.mockReturnValue([
        {
          id: 'gmail-1',
          type: 'gmail',
          name: 'Gmail',
          status: 'connected' as const,
          config: { refreshToken: 'some-token' },
        },
      ]);

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Google Calendar integration not configured',
      );
    });
  });

  describe('when integration is found but refreshToken is missing', () => {
    it('throws when config has no refreshToken field', async () => {
      mockLoadIntegrations.mockReturnValue([
        makeCalendarIntegration({ config: { clientId: 'id', clientSecret: 'secret' } }),
      ]);

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Google Calendar integration not configured',
      );
    });

    it('throws when config has an empty string refreshToken', async () => {
      mockLoadIntegrations.mockReturnValue([
        makeCalendarIntegration({
          config: { clientId: 'id', clientSecret: 'secret', refreshToken: '' },
        }),
      ]);

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Google Calendar integration not configured',
      );
    });
  });

  describe('when googleapis returns a null or empty access token', () => {
    it('throws when getAccessToken returns null token', async () => {
      mockLoadIntegrations.mockReturnValue([makeCalendarIntegration()]);
      mockGetAccessToken.mockResolvedValue({ token: null });

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Failed to refresh Google Calendar access token',
      );
    });

    it('throws when getAccessToken returns undefined token', async () => {
      mockLoadIntegrations.mockReturnValue([makeCalendarIntegration()]);
      mockGetAccessToken.mockResolvedValue({ token: undefined });

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Failed to refresh Google Calendar access token',
      );
    });

    it('throws when getAccessToken returns an empty string token', async () => {
      mockLoadIntegrations.mockReturnValue([makeCalendarIntegration()]);
      mockGetAccessToken.mockResolvedValue({ token: '' });

      await expect(getCalendarAccessToken()).rejects.toThrow(
        'Failed to refresh Google Calendar access token',
      );
    });
  });

  describe('happy path', () => {
    it('returns the access token when a valid google-calendar integration exists', async () => {
      mockLoadIntegrations.mockReturnValue([makeCalendarIntegration()]);
      mockGetAccessToken.mockResolvedValue({ token: 'ya29.valid-access-token' });

      const token = await getCalendarAccessToken();

      expect(token).toBe('ya29.valid-access-token');
    });

    it('uses setCredentials with the stored refreshToken before calling getAccessToken', async () => {
      mockLoadIntegrations.mockReturnValue([makeCalendarIntegration()]);
      mockGetAccessToken.mockResolvedValue({ token: 'ya29.valid-access-token' });

      await getCalendarAccessToken();

      expect(mockSetCredentials).toHaveBeenCalledWith({
        refresh_token: 'fake-refresh-token',
      });
      expect(mockGetAccessToken).toHaveBeenCalledOnce();
    });

    it('finds integration by specific integrationId when provided', async () => {
      const targetIntegration = makeCalendarIntegration({
        id: 'gcal-specific',
        config: {
          clientId: 'id',
          clientSecret: 'secret',
          refreshToken: 'specific-refresh-token',
        },
      });
      mockLoadIntegrations.mockReturnValue([
        makeCalendarIntegration({ id: 'gcal-other' }),
        targetIntegration,
      ]);
      mockGetAccessToken.mockResolvedValue({ token: 'ya29.specific-token' });

      const token = await getCalendarAccessToken('gcal-specific');

      expect(token).toBe('ya29.specific-token');
      expect(mockSetCredentials).toHaveBeenCalledWith({
        refresh_token: 'specific-refresh-token',
      });
    });

    it('falls back to the first google-calendar integration with a refreshToken when no id given', async () => {
      mockLoadIntegrations.mockReturnValue([
        // This one has no refreshToken — should be skipped
        makeCalendarIntegration({
          id: 'gcal-no-token',
          config: { clientId: 'id', clientSecret: 'secret' },
        }),
        makeCalendarIntegration({
          id: 'gcal-with-token',
          config: {
            clientId: 'id',
            clientSecret: 'secret',
            refreshToken: 'fallback-refresh-token',
          },
        }),
      ]);
      mockGetAccessToken.mockResolvedValue({ token: 'ya29.fallback-token' });

      const token = await getCalendarAccessToken();

      expect(token).toBe('ya29.fallback-token');
      expect(mockSetCredentials).toHaveBeenCalledWith({
        refresh_token: 'fallback-refresh-token',
      });
    });
  });
});
