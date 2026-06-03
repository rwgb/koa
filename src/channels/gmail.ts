import { google } from 'googleapis';
import * as imapSimple from 'imap-simple';
import type { ImapSimpleOptions, ImapSimple } from 'imap-simple';
import Anthropic from '@anthropic-ai/sdk';
import { loadIntegrations, saveIntegration } from '../integrations/store.js';
import { isDuplicate, markProcessed, contentHash } from './dedup.js';
import { createTask } from '../db/index.js';
import type { ExtractedIntent } from './types.js';

// ── OAuth2 ────────────────────────────────────────────────────────────────────

const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function makeOAuth2Client(redirectUri?: string) {
  const integrations = loadIntegrations();
  const gmail = integrations.find(i => i.type === 'gmail');
  const clientId = gmail?.config['clientId'] ?? process.env['GMAIL_CLIENT_ID'] ?? '';
  const clientSecret = gmail?.config['clientSecret'] ?? process.env['GMAIL_CLIENT_SECRET'] ?? '';
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function generateOAuthUrl(redirectUri: string): string {
  const oauth2 = makeOAuth2Client(redirectUri);
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(
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

async function getAccessToken(): Promise<string> {
  const integrations = loadIntegrations();
  const gmail = integrations.find(i => i.type === 'gmail');
  if (!gmail) throw new Error('Gmail integration not configured');

  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials({ refresh_token: gmail.config['refreshToken'] ?? null });
  const { token } = await oauth2.getAccessToken();
  if (!token) throw new Error('Failed to refresh Gmail access token');
  return token;
}

// ── Intent extraction ─────────────────────────────────────────────────────────

const INTENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    type: { type: 'string', enum: ['task', 'query', 'note', 'unknown'] },
    content: { type: 'string' },
    project: { type: 'string' },
    deadline: { type: 'string' },
    priority: { type: 'number', minimum: 1, maximum: 5 },
  },
  required: ['type', 'content'],
};

export async function extractIntent(body: string, apiKey: string): Promise<ExtractedIntent> {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Extract intent from this message. Reply with JSON only matching the schema.\n\nSchema: ${JSON.stringify(INTENT_SCHEMA)}\n\nMessage:\n${body.slice(0, 2000)}`,
    }],
  });

  try {
    const text = msg.content.find(b => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text) as Partial<ExtractedIntent>;
    return {
      type: parsed.type ?? 'unknown',
      content: parsed.content ?? body.slice(0, 200),
      ...(parsed.project ? { project: parsed.project } : {}),
      ...(parsed.deadline ? { deadline: parsed.deadline } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
    };
  } catch {
    return { type: 'unknown', content: body.slice(0, 200) };
  }
}

// ── Poller ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export class GmailPoller {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _apiKey = '';
  private _processedTimestamps: number[] = [];
  private _running = false;

  start(apiKey: string): void {
    if (this._running) return;
    const integrations = loadIntegrations();
    const gmail = integrations.find(i => i.type === 'gmail' && i.status === 'connected');
    if (!gmail?.config['refreshToken']) return;
    this._apiKey = apiKey;
    this._running = true;
    this._timer = setInterval(() => { void this._poll(); }, POLL_INTERVAL_MS);
    (this._timer as NodeJS.Timeout & { unref?: () => void }).unref?.();
    void this._poll();
  }

  stop(): void {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _isRateLimited(): boolean {
    const now = Date.now();
    this._processedTimestamps = this._processedTimestamps.filter(
      t => now - t < RATE_LIMIT_WINDOW_MS,
    );
    return this._processedTimestamps.length >= RATE_LIMIT_MAX;
  }

  private async _poll(): Promise<void> {
    let connection: ImapSimple | null = null;
    try {
      const accessToken = await getAccessToken();
      // XOAUTH2 string format required by Gmail IMAP
      const xoauth2 = Buffer.from(
        `user=\x01auth=Bearer ${accessToken}\x01\x01`,
      ).toString('base64');

      const integrations = loadIntegrations();
      const gmail = integrations.find(i => i.type === 'gmail');
      const email = gmail?.config['email'] ?? '';

      // imap-simple Config requires 'password' but xoauth2 supersedes it at auth time.
      // We satisfy the type with an empty string; Gmail IMAP ignores it when xoauth2 is set.
      const opts: ImapSimpleOptions = {
        imap: {
          user: email,
          password: '',
          xoauth2,
          host: 'imap.gmail.com',
          port: 993,
          tls: true,
          tlsOptions: { rejectUnauthorized: true },
          authTimeout: 10000,
        },
      };

      connection = await imapSimple.connect(opts);
      await connection.openBox('INBOX');

      const since = new Date(Date.now() - POLL_INTERVAL_MS * 2);
      const messages = await connection.search(['UNSEEN', ['SINCE', since]], {
        bodies: ['HEADER.FIELDS (FROM SUBJECT)', 'TEXT'],
        markSeen: false,
      });

      for (const msg of messages) {
        if (this._isRateLimited()) {
          console.warn('[gmail] rate limit reached — skipping remaining messages');
          break;
        }

        const uid = String(msg.attributes.uid);
        const headerPart = msg.parts.find((p: imapSimple.Message['parts'][number]) => p.which === 'HEADER.FIELDS (FROM SUBJECT)');
        const textPart = msg.parts.find((p: imapSimple.Message['parts'][number]) => p.which === 'TEXT');
        const body = typeof textPart?.body === 'string' ? textPart.body : '';
        const headerBody = headerPart?.body as Record<string, string[]> | undefined;
        if (isDuplicate('gmail', uid)) continue;

        const hash = contentHash(body);
        const intent = await extractIntent(body, this._apiKey);

        if (intent.type === 'task' && intent.content) {
          try {
            const { listProjects } = await import('../db/index.js');
            const projects = listProjects();
            const match = intent.project
              ? projects.find(p => p.name.toLowerCase().includes((intent.project ?? '').toLowerCase()))
              : projects[0];
            if (match) {
              createTask(match.id, intent.content, {
                description: `Via Gmail from ${email}`,
                ...(intent.deadline ? { deadline: intent.deadline } : {}),
                ...(intent.priority ? { priority: intent.priority } : {}),
              });
            }
          } catch (e) {
            console.error('[gmail] createTask failed:', e);
          }
        }

        markProcessed('gmail', uid, hash, intent.type);
        this._processedTimestamps.push(Date.now());

        if (gmail) {
          saveIntegration({
            ...gmail,
            config: { ...gmail.config, lastPolledAt: new Date().toISOString() },
          });
        }
      }
    } catch (e) {
      console.error('[gmail] poll error:', e);
    } finally {
      try { connection?.end(); } catch { /* ignore */ }
    }
  }
}

export const gmailPoller = new GmailPoller();
