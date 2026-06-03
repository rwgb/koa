import { loadRules, loadQuietHours } from '../notifications/store.js';
import { sendNtfyNotification } from '../integrations/store.js';
import { sendSlack } from './slack.js';
import { sendSms } from './sms.js';
import { sendWebPush } from '../notifications/webpush.js';
import { sendApnsPush } from '../notifications/apns.js';
import { readCredentials } from '../config/credentials.js';
import type { ChannelSendResult } from './types.js';
import type { TelegramPoller } from './telegram.js';

// Module-level Telegram poller reference — set by the server after startup
let _telegramPoller: TelegramPoller | null = null;

export function setTelegramPoller(p: TelegramPoller | null): void {
  _telegramPoller = p;
}

// ── Quiet hours ──────────────────────────────────────────────────────────────

export function isQuietHours(): boolean {
  const qh = loadQuietHours();
  if (!qh.enabled) return false;

  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const [fromH, fromM] = qh.from.split(':').map(Number) as [number, number];
  const [toH, toM] = qh.to.split(':').map(Number) as [number, number];
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const fromMins = fromH * 60 + fromM;
  const toMins = toH * 60 + toM;

  void hhmm; // used indirectly via nowMins
  if (fromMins < toMins) {
    // Same day window e.g. 08:00–22:00
    return nowMins >= fromMins && nowMins < toMins;
  } else {
    // Cross-midnight window e.g. 22:00–08:00
    return nowMins >= fromMins || nowMins < toMins;
  }
}

// ── Batch buffer ─────────────────────────────────────────────────────────────

interface BatchEntry {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  channel: string;
  event: string;
}

const batchBuffer = new Map<string, BatchEntry>();
const BATCH_WINDOW_MS = 5 * 60 * 1000;
const BATCH_THRESHOLD = 3;

async function flushBatch(key: string): Promise<void> {
  const entry = batchBuffer.get(key);
  if (!entry) return;
  batchBuffer.delete(key);
  clearTimeout(entry.timer);
  const title = `Koa: ${entry.messages.length} notifications`;
  const body = entry.messages.slice(0, 10).join('\n');
  await dispatchToChannel(entry.channel, title, body);
}

// ── Exponential retry ────────────────────────────────────────────────────────

async function withRetry(fn: () => Promise<ChannelSendResult>): Promise<void> {
  const delays = [1000, 2000, 4000];
  for (let i = 0; i <= delays.length; i++) {
    const result = await fn();
    if (result.ok) return;
    if (i < delays.length) {
      await new Promise(r => setTimeout(r, delays[i]));
    } else {
      console.error('[channels/router] all retries exhausted:', result.error);
    }
  }
}

// ── Channel dispatch ─────────────────────────────────────────────────────────

async function dispatchToChannel(channel: string, title: string, body: string): Promise<void> {
  switch (channel) {
    case 'ntfy':
      await withRetry(async () => {
        try {
          await sendNtfyNotification(title, body);
          return { ok: true, attempts: 1 };
        } catch (e) {
          return { ok: false, error: String(e), attempts: 1 };
        }
      });
      break;
    case 'slack':
      await withRetry(() => sendSlack(`*${title}*\n${body}`));
      break;
    case 'sms':
      // SMS outbound requires a 'to' number — skip for generic routing
      console.warn('[channels/router] SMS outbound requires explicit recipient — skipping');
      break;
    case 'web-push':
      await withRetry(async () => {
        const result = await sendWebPush(title, body);
        return result.ok
          ? { ok: true as const, attempts: 1 }
          : { ok: false as const, error: result.error ?? 'web push failed', attempts: 1 };
      });
      break;
    case 'apns':
      await withRetry(async () => {
        const result = await sendApnsPush(title, body, { category: 'KOA_REPLY' });
        return result.ok
          ? { ok: true as const, attempts: 1 }
          : { ok: false as const, error: result.error ?? 'APNs push failed', attempts: 1 };
      });
      break;
    case 'telegram': {
      const creds = readCredentials();
      const chatId = creds['TELEGRAM_DEFAULT_CHAT_ID'];
      if (!chatId || !_telegramPoller) {
        console.warn('[channels/router] Telegram not configured or poller not running — skipping');
        break;
      }
      await withRetry(async () => {
        try {
          await _telegramPoller!.sendMessage(chatId, `*${title}*\n${body}`);
          return { ok: true as const, attempts: 1 };
        } catch (e) {
          return { ok: false as const, error: String(e), attempts: 1 };
        }
      });
      break;
    }
    default:
      console.warn('[channels/router] unknown channel:', channel);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function routeResponse(
  event: string,
  title: string,
  body: string,
  opts?: { critical?: boolean },
): Promise<void> {
  const rules = loadRules();
  const matchingRule = rules.find(r => r.event === event || r.event === '*');

  // Fall back to ntfy if no rules configured
  const channel = matchingRule?.channel ?? 'ntfy';

  if (isQuietHours() && !opts?.critical) return;

  const batchKey = `${channel}:${event}`;
  const existing = batchBuffer.get(batchKey);

  if (existing) {
    existing.messages.push(body);
    if (existing.messages.length >= BATCH_THRESHOLD) {
      await flushBatch(batchKey);
    }
    return;
  }

  // Start a new batch window
  const timer = setTimeout(() => { void flushBatch(batchKey); }, BATCH_WINDOW_MS);
  batchBuffer.set(batchKey, { messages: [body], timer, channel, event });
  // Deliver first message immediately; subsequent ones batch
  await dispatchToChannel(channel, title, body);
}
