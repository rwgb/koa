import crypto from 'crypto';
import { loadIntegrations } from '../integrations/store.js';
import type { ChannelSendResult, InboundMessage } from './types.js';

const SMS_MAX_CHARS = 160;

// ── Inbound parsing ───────────────────────────────────────────────────────────

export function parseTwilioBody(body: Record<string, string>): InboundMessage {
  return {
    channel: 'sms',
    externalId: body['MessageSid'] ?? '',
    from: body['From'] ?? '',
    body: body['Body'] ?? '',
    receivedAt: new Date().toISOString(),
  };
}

// Twilio signature: HMAC-SHA1 of (url + sorted POST params), base64.
// https://www.twilio.com/docs/usage/security#validating-signatures-from-twilio
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const sorted = Object.keys(params).sort();
  const payload = url + sorted.map(k => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', authToken).update(payload).digest('base64');
  // Constant-time compare
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── Outbound ──────────────────────────────────────────────────────────────────

function truncateSms(text: string): string {
  return text.length > SMS_MAX_CHARS ? text.slice(0, SMS_MAX_CHARS - 1) + '…' : text;
}

export async function sendSms(to: string, body: string): Promise<ChannelSendResult> {
  const integrations = loadIntegrations();
  const twilio = integrations.find(i => i.type === 'twilio' && i.status === 'connected');
  if (!twilio) return { ok: false, error: 'Twilio integration not configured', attempts: 1 };

  const accountSid = twilio.config['accountSid'];
  const authToken = twilio.config['authToken'];
  const fromNumber = twilio.config['fromNumber'];

  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, error: 'Twilio credentials incomplete', attempts: 1 };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body64 = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  try {
    const form = new URLSearchParams({ To: to, From: fromNumber, Body: truncateSms(body) });
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${body64}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (r.ok) return { ok: true, attempts: 1 };
    return { ok: false, error: `HTTP ${r.status}`, attempts: 1 };
  } catch (e) {
    return { ok: false, error: (e as Error).message, attempts: 1 };
  }
}
