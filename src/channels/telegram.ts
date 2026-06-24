import type { AgentLoop } from '../agent/loop.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';
const POLL_TIMEOUT = 30; // long-poll seconds

/**
 * Build the set of allowed Telegram chat IDs from environment variables.
 * Returns an empty set when no allowlist is configured (allow-all mode).
 *
 * TELEGRAM_ALLOWED_CHAT_IDS  — comma-separated list of chat IDs (primary)
 * TELEGRAM_DEFAULT_CHAT_ID   — single chat ID (backwards-compat fallback)
 */
function buildAllowlist(): Set<string> {
  const ids = new Set<string>();

  const multi = process.env['TELEGRAM_ALLOWED_CHAT_IDS'];
  if (multi) {
    for (const id of multi.split(',')) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
  }

  const single = process.env['TELEGRAM_DEFAULT_CHAT_ID']?.trim();
  if (single) ids.add(single);

  return ids;
}

export class TelegramPoller {
  private token: string;
  private loop: AgentLoop;
  private running = false;
  private offset = 0;
  private controller: AbortController | null = null;

  constructor(token: string, loop: AgentLoop) {
    this.token = token;
    this.loop = loop;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    process.stderr.write('[Telegram] polling started\n');
    void this.poll();
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    process.stderr.write('[Telegram] polling stopped\n');
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    // Telegram message limit is 4096 chars
    const body = text.length > 4000 ? text.slice(0, 3997) + '…' : text;
    await fetch(`${TELEGRAM_API}${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'Markdown' }),
    }).catch(() => {});
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        this.controller = new AbortController();
        const res = await fetch(
          `${TELEGRAM_API}${this.token}/getUpdates?offset=${this.offset}&timeout=${POLL_TIMEOUT}`,
          { signal: this.controller.signal },
        );
        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
        if (!data.ok) { await new Promise((r) => setTimeout(r, 5000)); continue; }

        for (const update of data.result) {
          this.offset = update.update_id + 1;
          const msg = update.message;
          if (!msg?.text || !msg.chat?.id) continue;
          void this.handleMessage(msg.chat.id, msg.text);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleMessage(chatId: number, text: string): Promise<void> {
    const allowlist = buildAllowlist();
    if (allowlist.size > 0 && !allowlist.has(String(chatId))) {
      process.stderr.write(`[Telegram] unauthorized chat ID ${chatId} — dropping message\n`);
      return;
    }
    try {
      const result = await this.loop.turn(text);
      if (result.content) {
        await this.sendMessage(chatId, result.content);
      }
    } catch (err) {
      process.stderr.write(`[Telegram] handleMessage error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}
