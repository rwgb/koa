import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { MODELS, extractTierOverride, classifyMessage, classifyWithHaiku, selectModel } from '../agent/router.js';

// Stub Anthropic client — only messages.create is relevant to these tests
function makeClient(responseText: string, shouldThrow = false): Anthropic {
  return {
    messages: {
      create: vi.fn().mockImplementation(() =>
        shouldThrow
          ? Promise.reject(new Error('API error'))
          : Promise.resolve({
              content: [{ type: 'text', text: responseText }],
              usage: { input_tokens: 10, output_tokens: 1 },
            }),
      ),
    },
  } as unknown as Anthropic;
}

// A stub client that should never be called (for fast-path tests)
function noCallClient(): Anthropic {
  return {
    messages: {
      create: vi.fn().mockRejectedValue(new Error('classifier should not have been called')),
    },
  } as unknown as Anthropic;
}

describe('extractTierOverride', () => {
  it('returns null tier and original message when no prefix is present', () => {
    const result = extractTierOverride('What is the capital of France?');
    expect(result.tier).toBeNull();
    expect(result.message).toBe('What is the capital of France?');
  });

  it('strips @haiku: prefix (lowercase)', () => {
    const result = extractTierOverride('@haiku: summarise this file');
    expect(result.tier).toBe('haiku');
    expect(result.message).toBe('summarise this file');
  });

  it('strips @haiku: prefix (uppercase)', () => {
    const result = extractTierOverride('@HAIKU: summarise this file');
    expect(result.tier).toBe('haiku');
    expect(result.message).toBe('summarise this file');
  });

  it('strips @sonnet: prefix (mixed case)', () => {
    const result = extractTierOverride('@Sonnet: explain the architecture');
    expect(result.tier).toBe('sonnet');
    expect(result.message).toBe('explain the architecture');
  });

  it('strips @opus: prefix (lowercase)', () => {
    const result = extractTierOverride('@opus: rewrite this entire module');
    expect(result.tier).toBe('opus');
    expect(result.message).toBe('rewrite this entire module');
  });

  it('strips leading whitespace after the colon', () => {
    const result = extractTierOverride('@haiku:   no leading spaces please');
    expect(result.tier).toBe('haiku');
    expect(result.message).toBe('no leading spaces please');
  });

  it('does not match a prefix that is mid-message', () => {
    const result = extractTierOverride('Please use @haiku: for this');
    expect(result.tier).toBeNull();
    expect(result.message).toBe('Please use @haiku: for this');
  });
});

describe('classifyMessage', () => {
  it('classifies a short simple question as simple', () => {
    expect(classifyMessage('What is a closure?')).toBe('simple');
  });

  it('classifies a message longer than 400 characters as complex', () => {
    const long = 'x'.repeat(401);
    expect(classifyMessage(long)).toBe('complex');
  });

  it('classifies a message matching COMPLEX_RE keyword "refactor" as complex', () => {
    expect(classifyMessage('Can you refactor the auth module?')).toBe('complex');
  });

  it('classifies a message matching COMPLEX_RE keyword "implement" as complex', () => {
    expect(classifyMessage('implement a retry mechanism')).toBe('complex');
  });

  it('classifies a message matching COMPLEX_RE keyword "debug" as complex', () => {
    expect(classifyMessage('debug this failing test')).toBe('complex');
  });

  it('classifies a message matching SIMPLE_RE keyword "list" as simple', () => {
    expect(classifyMessage('list all files in this directory')).toBe('simple');
  });

  it('classifies a message matching SIMPLE_RE keyword "show" as simple', () => {
    expect(classifyMessage('show me the config')).toBe('simple');
  });

  it('classifies a medium message with no keyword match as moderate', () => {
    // >120 chars but no SIMPLE_RE / COMPLEX_RE match
    const medium = 'This is a medium-length message that does not match either regex pattern ' +
      'and sits between simple and complex in the classification space.';
    expect(medium.length).toBeGreaterThan(120);
    expect(medium.length).toBeLessThanOrEqual(400);
    expect(classifyMessage(medium)).toBe('moderate');
  });

  it('classifies a short message with no regex match as moderate', () => {
    // Not a SIMPLE_RE opener, short enough to not be complex by length
    expect(classifyMessage('Explain closures briefly')).toBe('moderate');
  });

  it('returns complex when recentToolUseCount >= 3 regardless of message', () => {
    expect(classifyMessage('What is 2 + 2?', 3)).toBe('complex');
    expect(classifyMessage('What is 2 + 2?', 10)).toBe('complex');
  });

  it('does not force complex when recentToolUseCount < 3', () => {
    expect(classifyMessage('What is 2 + 2?', 2)).toBe('simple');
  });
});

describe('classifyWithHaiku', () => {
  it('response "1" → simple', async () => {
    const client = makeClient('1');
    const result = await classifyWithHaiku('test message', client);
    expect(result.complexity).toBe('simple');
  });

  it('response "3" → complex', async () => {
    const client = makeClient('3');
    const result = await classifyWithHaiku('test message', client);
    expect(result.complexity).toBe('complex');
  });

  it('response "2" → moderate', async () => {
    const client = makeClient('2');
    const result = await classifyWithHaiku('test message', client);
    expect(result.complexity).toBe('moderate');
  });

  it('response "  2  " (whitespace) → moderate', async () => {
    const client = makeClient('  2  ');
    const result = await classifyWithHaiku('test message', client);
    expect(result.complexity).toBe('moderate');
  });

  it('response "banana" → moderate (unexpected output fallback)', async () => {
    const client = makeClient('banana');
    const result = await classifyWithHaiku('test message', client);
    expect(result.complexity).toBe('moderate');
  });

  it('API throws → returns moderate without rethrowing', async () => {
    const client = makeClient('', true);
    const result = await classifyWithHaiku('test message', client);
    expect(result.complexity).toBe('moderate');
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('returns token usage on success', async () => {
    const client = makeClient('1');
    const result = await classifyWithHaiku('test message', client);
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(1);
  });
});

describe('selectModel', () => {
  const baseConfig = { model: MODELS.sonnet, smartRouting: false };

  it('@haiku: override returns haiku model even when smartRouting is false', async () => {
    const result = await selectModel('@haiku: summarise this', 0, baseConfig, noCallClient());
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
    expect(result.cleanMessage).toBe('summarise this');
    expect(result.source).toBe('override');
  });

  it('@opus: override returns opus model even when smartRouting is false', async () => {
    const result = await selectModel('@opus: rewrite everything', 0, baseConfig, noCallClient());
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
    expect(result.cleanMessage).toBe('rewrite everything');
    expect(result.source).toBe('override');
  });

  it('@sonnet: override returns sonnet model even when smartRouting is false', async () => {
    const result = await selectModel('@sonnet: moderate task', 0, baseConfig, noCallClient());
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
    expect(result.cleanMessage).toBe('moderate task');
    expect(result.source).toBe('override');
  });

  it('smartRouting=false with no override returns the config model with correct tier label', async () => {
    const result = await selectModel('What is the weather?', 0, baseConfig, noCallClient());
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
    expect(result.cleanMessage).toBe('What is the weather?');
    expect(result.source).toBe('config');
  });

  it('smartRouting=false with haiku model in config returns haiku tier label', async () => {
    const result = await selectModel('list files', 0, { model: MODELS.haiku, smartRouting: false }, noCallClient());
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
  });

  it('smartRouting=false with opus model in config returns opus tier label', async () => {
    const result = await selectModel('complex task', 0, { model: MODELS.opus, smartRouting: false }, noCallClient());
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
  });

  it('smartRouting=true routes a simple message to haiku (regex fast-path, no classifier call)', async () => {
    const client = noCallClient();
    const result = await selectModel('What is a variable?', 0, { model: MODELS.sonnet, smartRouting: true }, client);
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
    expect(result.source).toBe('regex-fast-path');
    expect((client.messages.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('smartRouting=true routes a complex message to opus (regex fast-path, no classifier call)', async () => {
    const client = noCallClient();
    const result = await selectModel('refactor the entire authentication module', 0, { model: MODELS.sonnet, smartRouting: true }, client);
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
    expect(result.source).toBe('regex-fast-path');
    expect((client.messages.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('selectModel — moderate path (haiku classifier)', () => {
  const smartConfig = { model: MODELS.sonnet, smartRouting: true };

  // A moderate message: >120 chars, no keyword match
  const moderateMsg =
    'This is a medium-length message that does not match either regex pattern ' +
    'and sits between simple and complex in the classification space.';

  it('moderate message calls classifyWithHaiku exactly once', async () => {
    const client = makeClient('2');
    await selectModel(moderateMsg, 0, smartConfig, client);
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('moderate message + classifier returns "2" → routes to sonnet', async () => {
    const result = await selectModel(moderateMsg, 0, smartConfig, makeClient('2'));
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('haiku-classifier');
  });

  it('moderate message + classifier returns "1" → routes to haiku', async () => {
    const result = await selectModel(moderateMsg, 0, smartConfig, makeClient('1'));
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
    expect(result.source).toBe('haiku-classifier');
  });

  it('moderate message + classifier returns "3" → routes to opus', async () => {
    const result = await selectModel(moderateMsg, 0, smartConfig, makeClient('3'));
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
    expect(result.source).toBe('haiku-classifier');
  });

  it('moderate message + classifier error → falls back to sonnet (moderate)', async () => {
    const result = await selectModel(moderateMsg, 0, smartConfig, makeClient('', true));
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('haiku-classifier');
  });

  it('moderate path includes classifierLatencyMs', async () => {
    const result = await selectModel(moderateMsg, 0, smartConfig, makeClient('2'));
    expect(typeof result.classifierLatencyMs).toBe('number');
  });

  it('moderate path includes classifierUsage with token counts', async () => {
    const result = await selectModel(moderateMsg, 0, smartConfig, makeClient('2'));
    expect(result.classifierUsage?.inputTokens).toBe(10);
    expect(result.classifierUsage?.outputTokens).toBe(1);
  });

  it('smartRouting=false never calls classifier even for moderate message', async () => {
    const client = noCallClient();
    const result = await selectModel(moderateMsg, 0, { model: MODELS.sonnet, smartRouting: false }, client);
    expect((client.messages.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(result.source).toBe('config');
  });

  it('@haiku: override never calls classifier', async () => {
    const client = noCallClient();
    const result = await selectModel('@haiku: ' + moderateMsg, 0, smartConfig, client);
    expect((client.messages.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(result.source).toBe('override');
  });
});
