import { google } from 'googleapis';
import { loadIntegrations } from '../integrations/store.js';
import { readCredentials } from '../config/credentials.js';

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

function makeOAuth2Client(redirectUri?: string) {
  const integrations = loadIntegrations();
  const cal = integrations.find(i => i.type === 'google-calendar');
  const creds = readCredentials();
  const clientId = cal?.config['clientId'] ?? process.env['GOOGLE_CALENDAR_CLIENT_ID'] ?? process.env['GOOGLE_CLIENT_ID'] ?? creds['GOOGLE_CLIENT_ID'] ?? '';
  const clientSecret = cal?.config['clientSecret'] ?? process.env['GOOGLE_CALENDAR_CLIENT_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? creds['GOOGLE_CLIENT_SECRET'] ?? '';
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function generateCalendarOAuthUrl(redirectUri: string, state?: string): string {
  const oauth2 = makeOAuth2Client(redirectUri);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
    prompt: 'consent',
    ...(state ? { state } : {}),
  });
}

export async function exchangeCalendarCode(
  code: string,
  redirectUri: string,
): Promise<{ refresh_token: string; access_token: string }> {
  const oauth2 = makeOAuth2Client(redirectUri);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) throw new Error('No refresh_token — ensure prompt=consent was set');
  return {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? '',
  };
}

export async function getCalendarAccessToken(integrationId?: string): Promise<string> {
  const integrations = loadIntegrations();
  const cal = integrationId
    ? integrations.find(i => i.id === integrationId)
    : integrations.find(i => i.type === 'google-calendar' && i.config['refreshToken']);
  if (!cal?.config['refreshToken']) throw new Error('Google Calendar integration not configured');

  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials({ refresh_token: cal.config['refreshToken'] });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Failed to refresh Google Calendar access token');
  return token;
}

export function isCalendarConfigured(): boolean {
  const integrations = loadIntegrations();
  return integrations.some(i => i.type === 'google-calendar' && !!(i.config['refreshToken']));
}
