import crypto from 'crypto';
import { loadIntegrations } from '../integrations/store.js';
import { validateSafeUrl } from '../utils/ssrf.js';
import type { ChannelSendResult } from './types.js';

const SLACK_MAX_CHARS = 4000;
const SLACK_INBOUND_MAX_CHARS = 2000;
const SLACK_SIGNING_VERSION = 'v0';

/**
 * Validates Slack's HMAC-SHA256 request signature.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function validateSlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  // Reject requests older than 5 minutes (replay attack guard)
  const ts = parseInt(timestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const baseString = `${SLACK_SIGNING_VERSION}:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `${SLACK_SIGNING_VERSION}=${hmac}`;

  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

/**
 * Extracts the user-visible message text from a Slack event or slash command body.
 * Returns null if the payload is not an actionable message.
 */
export function parseSlackInbound(body: Record<string, unknown>): {
  type: 'slash_command' | 'app_mention';
  text: string;
  channelId: string;
  responseUrl?: string;
} | null {
  // Slash command: body has 'command' field
  if (typeof body['command'] === 'string' && typeof body['text'] === 'string') {
    const text = (body['text'] as string).trim().slice(0, SLACK_INBOUND_MAX_CHARS);
    if (!text) return null;
    const result: { type: 'slash_command'; text: string; channelId: string; responseUrl?: string } = {
      type: 'slash_command',
      text,
      channelId: (body['channel_id'] as string) ?? '',
    };
    if (typeof body['response_url'] === 'string') result.responseUrl = body['response_url'];
    return result;
  }

  // Events API: body has 'event' field
  const event = body['event'] as Record<string, unknown> | undefined;
  if (event?.['type'] === 'app_mention' && typeof event['text'] === 'string') {
    // Strip the @mention prefix: "<@U12345> fix the bug" → "fix the bug"
    const text = (event['text'] as string).replace(/<@[A-Z0-9]+>\s*/g, '').trim().slice(0, SLACK_INBOUND_MAX_CHARS);
    if (!text) return null;
    return {
      type: 'app_mention',
      text,
      channelId: (event['channel'] as string) ?? '',
    };
  }

  return null;
}

/**
 * Posts a reply back to Slack via the response_url (for slash commands)
 * or via chat.postMessage (for event subscriptions).
 */
export async function replyToSlack(
  text: string,
  opts: { responseUrl?: string; channelId?: string; botToken?: string },
): Promise<void> {
  const truncated = text.length > SLACK_MAX_CHARS ? text.slice(0, SLACK_MAX_CHARS - 3) + '...' : text;

  if (opts.responseUrl) {
    try {
      validateSafeUrl(opts.responseUrl, h => h.endsWith('.slack.com'));
    } catch (e) {
      console.error('replyToSlack: blocked unsafe responseUrl:', (e as Error).message);
      return;
    }
    await fetch(opts.responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: truncated, response_type: 'in_channel' }),
    }).catch(() => {});
    return;
  }

  if (opts.channelId && opts.botToken) {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opts.botToken}`,
      },
      body: JSON.stringify({ channel: opts.channelId, text: truncated }),
    }).catch(() => {});
  }
}

function validateSlackUrl(url: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Invalid Slack webhook URL'); }
  if (parsed.protocol !== 'https:') throw new Error('Slack webhook URL must use HTTPS');
  if (parsed.hostname !== 'hooks.slack.com') throw new Error('Slack webhook URL must be on hooks.slack.com');
}

export async function sendSlack(text: string): Promise<ChannelSendResult> {
  const integrations = loadIntegrations();
  const slack = integrations.find(i => i.type === 'slack' && i.status === 'connected');
  if (!slack) return { ok: false, error: 'Slack integration not configured', attempts: 1 };

  const webhookUrl = slack.config['webhookUrl'];
  if (!webhookUrl || webhookUrl === '***') {
    return { ok: false, error: 'Slack webhook URL missing', attempts: 1 };
  }

  try { validateSlackUrl(webhookUrl); } catch (e) {
    return { ok: false, error: (e as Error).message, attempts: 1 };
  }

  const truncated = text.length > SLACK_MAX_CHARS
    ? text.slice(0, SLACK_MAX_CHARS - 3) + '...'
    : text;

  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: truncated }),
    });
    if (r.ok) return { ok: true, attempts: 1 };
    return { ok: false, error: `HTTP ${r.status}`, attempts: 1 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, attempts: 1 };
  }
}
