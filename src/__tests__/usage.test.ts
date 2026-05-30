import { describe, it, expect, beforeEach } from 'vitest';
import { getPricing, UsageTracker } from '../agent/usage.js';

describe('getPricing', () => {
  it('returns haiku rates for haiku model', () => {
    const p = getPricing('claude-haiku-3');
    expect(p.inputPerM).toBe(0.80);
    expect(p.outputPerM).toBe(4.00);
  });

  it('returns sonnet rates for sonnet model', () => {
    const p = getPricing('claude-sonnet-4-5');
    expect(p.inputPerM).toBe(3.00);
    expect(p.outputPerM).toBe(15.00);
  });

  it('returns opus rates for opus model', () => {
    const p = getPricing('claude-opus-4');
    expect(p.inputPerM).toBe(15.00);
    expect(p.outputPerM).toBe(75.00);
  });

  it('returns default (sonnet) rates for unknown model', () => {
    const p = getPricing('claude-unknown-999');
    expect(p.inputPerM).toBe(3.00);
    expect(p.outputPerM).toBe(15.00);
  });

  it('prefix matching is future-proof for sonnet versions', () => {
    const p = getPricing('claude-sonnet-4-99');
    expect(p.inputPerM).toBe(3.00);
    expect(p.cacheReadPerM).toBe(0.30);
  });

  it('prefix matching is future-proof for haiku versions', () => {
    const p = getPricing('claude-haiku-99-20260101');
    expect(p.inputPerM).toBe(0.80);
  });
});

describe('UsageTracker', () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  it('fresh tracker returns all zeros', () => {
    const stats = tracker.getStats();
    expect(stats.inputTokens).toBe(0);
    expect(stats.outputTokens).toBe(0);
    expect(stats.cacheWriteTokens).toBe(0);
    expect(stats.cacheReadTokens).toBe(0);
    expect(stats.estimatedCostUsd).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.turnsCount).toBe(0);
  });

  it('cacheHitRate is 0 (not NaN) when all tokens are 0', () => {
    const stats = tracker.getStats();
    expect(Number.isNaN(stats.cacheHitRate)).toBe(false);
    expect(stats.cacheHitRate).toBe(0);
  });

  it('single turn no cache: tokens accumulate, cacheHitRate=0, turnsCount=1', () => {
    tracker.addTurn({
      inputTokens: 1000,
      outputTokens: 500,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      model: 'claude-sonnet-4-5',
    });
    const stats = tracker.getStats();
    expect(stats.inputTokens).toBe(1000);
    expect(stats.outputTokens).toBe(500);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.turnsCount).toBe(1);
  });

  it('single turn with cache read: cacheHitRate computed correctly', () => {
    tracker.addTurn({
      inputTokens: 1000,
      outputTokens: 200,
      cacheWriteTokens: 500,
      cacheReadTokens: 800,
      model: 'claude-sonnet-4-5',
    });
    const stats = tracker.getStats();
    // cacheHitRate = 800 / (1000 + 800 + 500) = 800 / 2300
    expect(stats.cacheHitRate).toBeCloseTo(800 / 2300, 6);
  });

  it('two turns: all counters sum across calls', () => {
    tracker.addTurn({ inputTokens: 100, outputTokens: 50, cacheWriteTokens: 10, cacheReadTokens: 20, model: 'claude-haiku-3' });
    tracker.addTurn({ inputTokens: 200, outputTokens: 100, cacheWriteTokens: 20, cacheReadTokens: 40, model: 'claude-haiku-3' });
    const stats = tracker.getStats();
    expect(stats.inputTokens).toBe(300);
    expect(stats.outputTokens).toBe(150);
    expect(stats.cacheWriteTokens).toBe(30);
    expect(stats.cacheReadTokens).toBe(60);
    expect(stats.turnsCount).toBe(2);
  });

  it('estimatedCostUsd: 1M input tokens at sonnet rate = $3.00', () => {
    tracker.addTurn({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      model: 'claude-sonnet-4-5',
    });
    expect(tracker.getStats().estimatedCostUsd).toBeCloseTo(3.00, 6);
  });

  it('estimatedCostUsd: 1M output tokens at sonnet rate = $15.00', () => {
    tracker.addTurn({
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      model: 'claude-sonnet-4-5',
    });
    expect(tracker.getStats().estimatedCostUsd).toBeCloseTo(15.00, 6);
  });

  it('reset() zeroes everything', () => {
    tracker.addTurn({ inputTokens: 500, outputTokens: 200, cacheWriteTokens: 100, cacheReadTokens: 50, model: 'claude-opus-4' });
    tracker.reset();
    const stats = tracker.getStats();
    expect(stats.inputTokens).toBe(0);
    expect(stats.outputTokens).toBe(0);
    expect(stats.cacheWriteTokens).toBe(0);
    expect(stats.cacheReadTokens).toBe(0);
    expect(stats.estimatedCostUsd).toBe(0);
    expect(stats.cacheHitRate).toBe(0);
    expect(stats.turnsCount).toBe(0);
  });
});
