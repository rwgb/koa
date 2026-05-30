import { describe, it, expect } from 'vitest';
import { MODELS, extractTierOverride, classifyMessage, selectModel } from '../agent/router.js';

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

describe('selectModel', () => {
  const baseConfig = { model: MODELS.sonnet, smartRouting: false };

  it('@haiku: override returns haiku model even when smartRouting is false', () => {
    const result = selectModel('@haiku: summarise this', 0, baseConfig);
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
    expect(result.cleanMessage).toBe('summarise this');
  });

  it('@opus: override returns opus model even when smartRouting is false', () => {
    const result = selectModel('@opus: rewrite everything', 0, baseConfig);
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
    expect(result.cleanMessage).toBe('rewrite everything');
  });

  it('@sonnet: override returns sonnet model even when smartRouting is false', () => {
    const result = selectModel('@sonnet: moderate task', 0, baseConfig);
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
    expect(result.cleanMessage).toBe('moderate task');
  });

  it('smartRouting=false with no override returns the config model with correct tier label', () => {
    const result = selectModel('What is the weather?', 0, baseConfig);
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
    expect(result.cleanMessage).toBe('What is the weather?');
  });

  it('smartRouting=false with haiku model in config returns haiku tier label', () => {
    const result = selectModel('list files', 0, { model: MODELS.haiku, smartRouting: false });
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
  });

  it('smartRouting=false with opus model in config returns opus tier label', () => {
    const result = selectModel('complex task', 0, { model: MODELS.opus, smartRouting: false });
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
  });

  it('smartRouting=true routes a simple message to haiku', () => {
    const config = { model: MODELS.sonnet, smartRouting: true };
    const result = selectModel('What is a variable?', 0, config);
    expect(result.model).toBe(MODELS.haiku);
    expect(result.tier).toBe('haiku');
  });

  it('smartRouting=true routes a complex message to opus', () => {
    const config = { model: MODELS.sonnet, smartRouting: true };
    const result = selectModel('refactor the entire authentication module', 0, config);
    expect(result.model).toBe(MODELS.opus);
    expect(result.tier).toBe('opus');
  });

  it('smartRouting=true routes a moderate message to sonnet', () => {
    const config = { model: MODELS.sonnet, smartRouting: true };
    // Medium-length message with no keyword match → moderate
    const moderate = 'This is a medium-length message that does not match either regex pattern ' +
      'and sits between simple and complex in the classification space.';
    const result = selectModel(moderate, 0, config);
    expect(result.model).toBe(MODELS.sonnet);
    expect(result.tier).toBe('sonnet');
  });
});
