import { google } from 'googleapis';
import { loadIntegrations } from '../integrations/store.js';

const EMAIL_RE = /^[^@\s\r\n]+@[^@\s\r\n]+\.[^@\s\r\n]+$/;
const MSG_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]/g, ' ').trim();
}

function makeOAuth2Client() {
  const integrations = loadIntegrations();
  const gmail = integrations.find(i => i.type === 'gmail' || i.type === 'google-gmail');
  const clientId = gmail?.config['clientId'] ?? process.env['GMAIL_CLIENT_ID'] ?? '';
  const clientSecret = gmail?.config['clientSecret'] ?? process.env['GMAIL_CLIENT_SECRET'] ?? '';
  return new google.auth.OAuth2(clientId, clientSecret);
}

async function getRefreshToken(): Promise<string> {
  const integrations = loadIntegrations();
  const gmail = integrations.find(i => i.type === 'gmail' || i.type === 'google-gmail');
  const token = gmail?.config['refreshToken'] ?? process.env['GOOGLE_GMAIL_REFRESH_TOKEN'] ?? '';
  if (!token) throw new Error('Gmail refresh token not configured');
  return token;
}

function encodeBase64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function isValidEmail(address: string): boolean {
  return EMAIL_RE.test(address);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
}): Promise<string> {
  const { to, subject, body, replyToMessageId } = opts;

  if (!isValidEmail(to)) throw new Error(`Invalid email address: ${to}`);
  if (replyToMessageId && !MSG_ID_RE.test(replyToMessageId)) {
    throw new Error('Invalid replyToMessageId format');
  }

  const oauth2 = makeOAuth2Client();
  const refreshToken = await getRefreshToken();
  oauth2.setCredentials({ refresh_token: refreshToken });

  const { token: accessToken } = await oauth2.getAccessToken();
  if (!accessToken) throw new Error('Failed to refresh Gmail access token');

  const gmailAuth = new google.auth.OAuth2();
  gmailAuth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: gmailAuth });

  let threadId: string | undefined;
  const extraHeaders: string[] = [];

  if (replyToMessageId) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: replyToMessageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID'],
    });
    if (msg.data.threadId) threadId = msg.data.threadId;
    const msgIdHeader = msg.data.payload?.headers?.find(h => h.name === 'Message-ID')?.value;
    if (msgIdHeader) {
      const safeId = sanitizeHeader(msgIdHeader);
      extraHeaders.push(`In-Reply-To: ${safeId}`);
      extraHeaders.push(`References: ${safeId}`);
    }
  }

  const rawLines = [
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    'Content-Type: text/plain; charset=utf-8',
    ...extraHeaders,
    '',
    body,
  ];
  const raw = encodeBase64url(rawLines.join('\r\n'));

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw,
      ...(threadId ? { threadId } : {}),
    },
  });

  const sentHeaders = response.data.payload?.headers ?? [];
  const messageId = sentHeaders.find(h => h.name === 'Message-ID')?.value ?? response.data.id ?? '';
  return messageId;
}
