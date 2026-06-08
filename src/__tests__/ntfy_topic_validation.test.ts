import { describe, it, expect } from 'vitest';
import { NTFY_TOPIC_RE } from '../server/routes/admin.js';

describe('NTFY_TOPIC_RE', () => {
  it('accepts alphanumeric topics', () => {
    expect(NTFY_TOPIC_RE.test('mytopic')).toBe(true);
    expect(NTFY_TOPIC_RE.test('MyTopic123')).toBe(true);
  });

  it('accepts hyphens and underscores', () => {
    expect(NTFY_TOPIC_RE.test('my-topic')).toBe(true);
    expect(NTFY_TOPIC_RE.test('my_topic')).toBe(true);
    expect(NTFY_TOPIC_RE.test('koa-alerts_v2')).toBe(true);
  });

  it('accepts a single character', () => {
    expect(NTFY_TOPIC_RE.test('a')).toBe(true);
  });

  it('accepts a 64-character topic', () => {
    expect(NTFY_TOPIC_RE.test('a'.repeat(64))).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(NTFY_TOPIC_RE.test('')).toBe(false);
  });

  it('rejects a 65-character topic', () => {
    expect(NTFY_TOPIC_RE.test('a'.repeat(65))).toBe(false);
  });

  it('rejects slashes (path traversal)', () => {
    expect(NTFY_TOPIC_RE.test('my/topic')).toBe(false);
    expect(NTFY_TOPIC_RE.test('../etc/passwd')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(NTFY_TOPIC_RE.test('my topic')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(NTFY_TOPIC_RE.test('topic?foo=bar')).toBe(false);
    expect(NTFY_TOPIC_RE.test('topic#section')).toBe(false);
    expect(NTFY_TOPIC_RE.test('<script>')).toBe(false);
  });
});
