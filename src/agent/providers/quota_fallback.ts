import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmStream, LlmCallParams } from './types.js';

// Matches Anthropic 429 rate-limit responses and quota/billing exhaustion errors.
// The SDK exposes the HTTP status on APIError instances; the message regex covers
// quota errors surfaced as other statuses (e.g. 400 "credit balance is too low").
export function isQuotaError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  if ((err as { status?: unknown }).status === 429) return true;
  const message = err instanceof Error ? err.message : '';
  return /rate.?limit|quota|credit balance|usage limit/i.test(message);
}

// Model identifier stamped on fallback responses. loop.ts FREE_PRICING and the
// usage tracker key off 'claude-code' — echoing the requested model would bill
// subscription-served turns at API rates and misreport model/tier to the UI.
const FALLBACK_MODEL = 'claude-code';

// Wraps the Anthropic provider: when a call fails with a 429/quota error, the
// turn is retried via the ClaudeCode provider (subscription billing, separate
// quota). Disable with `quotaFallback: false` in config (CP16 reimplementation).
export class QuotaFallbackProvider implements LlmProvider {
  constructor(
    private readonly primary: LlmProvider,
    private readonly fallback: LlmProvider,
  ) {}

  stream(params: LlmCallParams): LlmStream {
    const listeners: Array<(text: string) => void> = [];
    const inner = this.primary.stream(params);

    const finalMessage = async (): Promise<Anthropic.Message> => {
      try {
        return await inner.finalMessage();
      } catch (err) {
        if (!isQuotaError(err)) throw err;
        process.stderr.write('[koa] quota fallback: using ClaudeCode for this turn\n');
        const fallbackStream = this.fallback.stream(params);
        for (const listener of listeners) fallbackStream.on('text', listener);
        const message = await fallbackStream.finalMessage();
        return { ...message, model: FALLBACK_MODEL };
      }
    };

    const result: LlmStream = {
      on(event: 'text', listener: (text: string) => void): typeof result {
        listeners.push(listener);
        inner.on(event, listener);
        return result;
      },
      finalMessage,
    };
    return result;
  }

  async create(params: LlmCallParams): Promise<Anthropic.Message> {
    try {
      return await this.primary.create(params);
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      process.stderr.write('[koa] quota fallback: using ClaudeCode for this turn\n');
      const message = await this.fallback.create(params);
      return { ...message, model: FALLBACK_MODEL };
    }
  }
}
