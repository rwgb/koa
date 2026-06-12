import { describe, it, expect, vi, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { QuotaFallbackProvider, isQuotaError } from '../agent/providers/quota_fallback.js';
import type { LlmProvider, LlmStream, LlmCallParams } from '../agent/providers/types.js';
import { UsageTracker } from '../agent/usage.js';

const params: LlmCallParams = {
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: [{ type: 'text', text: 'You are koa.' }],
  messages: [{ role: 'user', content: 'hello' }],
};

function makeMessage(text: string): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text, citations: [] }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    container: null,
    stop_details: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

function makeStream(result: Promise<Anthropic.Message>, text?: string): LlmStream {
  const listeners: Array<(t: string) => void> = [];
  const stream: LlmStream = {
    on(_event, listener) {
      listeners.push(listener);
      return stream;
    },
    finalMessage: () => {
      if (text !== undefined) listeners.forEach((l) => l(text));
      return result;
    },
  };
  return stream;
}

function quotaError(): Error {
  const err = new Error('rate limited') as Error & { status: number };
  err.status = 429;
  return err;
}

afterEach(() => vi.restoreAllMocks());

describe('isQuotaError', () => {
  it('matches status 429', () => {
    expect(isQuotaError(quotaError())).toBe(true);
  });

  it('matches quota/credit message text', () => {
    expect(isQuotaError(new Error('Your credit balance is too low'))).toBe(true);
    expect(isQuotaError(new Error('monthly quota exceeded'))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isQuotaError(new Error('connection refused'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('429')).toBe(false);
  });
});

describe('QuotaFallbackProvider.create', () => {
  it('returns the primary result when no error occurs', async () => {
    const primary: LlmProvider = {
      create: vi.fn().mockResolvedValue(makeMessage('primary')),
      stream: vi.fn(),
    };
    const fallback: LlmProvider = { create: vi.fn(), stream: vi.fn() };

    const msg = await new QuotaFallbackProvider(primary, fallback).create(params);
    expect(msg.content[0]).toMatchObject({ text: 'primary' });
    expect(msg.model).toBe('claude-sonnet-4-6');
    expect(fallback.create).not.toHaveBeenCalled();
  });

  it('falls back to ClaudeCode on 429 and logs the fallback', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const primary: LlmProvider = {
      create: vi.fn().mockRejectedValue(quotaError()),
      stream: vi.fn(),
    };
    const fallback: LlmProvider = {
      create: vi.fn().mockResolvedValue(makeMessage('fallback')),
      stream: vi.fn(),
    };

    const msg = await new QuotaFallbackProvider(primary, fallback).create(params);
    expect(msg.content[0]).toMatchObject({ text: 'fallback' });
    expect(msg.model).toBe('claude-code');
    expect(fallback.create).toHaveBeenCalledWith(params);
    expect(stderrSpy).toHaveBeenCalledWith(
      '[koa] quota fallback: using ClaudeCode for this turn\n',
    );
  });

  it('rethrows non-quota errors without falling back', async () => {
    const primary: LlmProvider = {
      create: vi.fn().mockRejectedValue(new Error('connection refused')),
      stream: vi.fn(),
    };
    const fallback: LlmProvider = { create: vi.fn(), stream: vi.fn() };

    await expect(new QuotaFallbackProvider(primary, fallback).create(params)).rejects.toThrow(
      'connection refused',
    );
    expect(fallback.create).not.toHaveBeenCalled();
  });
});

describe('QuotaFallbackProvider.stream', () => {
  it('forwards text events and finalMessage from the primary stream', async () => {
    const primary: LlmProvider = {
      create: vi.fn(),
      stream: vi.fn().mockReturnValue(makeStream(Promise.resolve(makeMessage('hi')), 'hi')),
    };
    const fallback: LlmProvider = { create: vi.fn(), stream: vi.fn() };

    const stream = new QuotaFallbackProvider(primary, fallback).stream(params);
    const parts: string[] = [];
    stream.on('text', (t) => parts.push(t));

    const msg = await stream.finalMessage();
    expect(msg.content[0]).toMatchObject({ text: 'hi' });
    expect(parts).toEqual(['hi']);
    expect(fallback.stream).not.toHaveBeenCalled();
  });

  it('retries via fallback stream on quota error, re-attaching listeners', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const primary: LlmProvider = {
      create: vi.fn(),
      stream: vi.fn().mockReturnValue(makeStream(Promise.reject(quotaError()))),
    };
    const fallback: LlmProvider = {
      create: vi.fn(),
      stream: vi
        .fn()
        .mockImplementation(() => makeStream(Promise.resolve(makeMessage('rescued')), 'rescued')),
    };

    const stream = new QuotaFallbackProvider(primary, fallback).stream(params);
    const parts: string[] = [];
    stream.on('text', (t) => parts.push(t));

    const msg = await stream.finalMessage();
    expect(msg.content[0]).toMatchObject({ text: 'rescued' });
    expect(msg.model).toBe('claude-code');
    expect(parts).toEqual(['rescued']);
    expect(fallback.stream).toHaveBeenCalledWith(params);
  });
});

describe('fallback cost attribution', () => {
  it('bills a fallback-attributed turn at $0 in the usage tracker', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const primary: LlmProvider = {
      create: vi.fn().mockRejectedValue(quotaError()),
      stream: vi.fn(),
    };
    const fallback: LlmProvider = {
      create: vi.fn().mockResolvedValue(makeMessage('fallback')),
      stream: vi.fn(),
    };

    const msg = await new QuotaFallbackProvider(primary, fallback).create(params);

    // Feed the fallback message through the same seam the loop uses for the
    // usage event — model 'claude-code' must map to the zero-cost tier.
    const tracker = new UsageTracker();
    tracker.addTurn({
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
      model: msg.model,
    });
    expect(tracker.getStats().estimatedCostUsd).toBe(0);
  });
});
