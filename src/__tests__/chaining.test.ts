import { describe, it, expect } from 'vitest';
import { detectCompletionSignal, shouldAutoChain } from '../agent/chaining.js';

describe('detectCompletionSignal', () => {
  it('returns detected:true confidence:1.0 for "all tests pass"', () => {
    const result = detectCompletionSignal('all tests pass and the build is green');
    expect(result).toEqual({ detected: true, confidence: 1.0 });
  });

  it('returns detected:false confidence:0 when exclusion signal present', () => {
    const result = detectCompletionSignal('still need to fix this before it is done');
    expect(result).toEqual({ detected: false, confidence: 0 });
  });

  it('returns detected:false confidence:0 when no keywords present', () => {
    const result = detectCompletionSignal('here is a review of the architecture');
    expect(result).toEqual({ detected: false, confidence: 0 });
  });

  it('returns confidence:0.7 when keyword is followed by "but" within 50 chars', () => {
    // "implemented" is the keyword; "but" follows within 50 chars
    const result = detectCompletionSignal('implemented the feature but there are edge cases');
    expect(result).toEqual({ detected: true, confidence: 0.7 });
  });

  it('returns confidence:0.7 when keyword is followed by "however" within 50 chars', () => {
    const result = detectCompletionSignal('fixed the bug however more testing is needed');
    expect(result).toEqual({ detected: true, confidence: 0.7 });
  });

  it('returns confidence:1.0 when keyword is present with no hedging word nearby', () => {
    const result = detectCompletionSignal('successfully deployed to production');
    expect(result).toEqual({ detected: true, confidence: 1.0 });
  });
});

describe('shouldAutoChain', () => {
  it('returns true for code-assistant with clear completion signal', () => {
    expect(shouldAutoChain('code-assistant', 'implemented and all tests pass')).toBe(true);
  });

  it('returns false for non-code-assistant agent even with completion signal', () => {
    expect(shouldAutoChain('project-manager', 'all tests pass')).toBe(false);
  });

  it('returns false when confidence is exactly 0.7 (not strictly greater)', () => {
    // "completed, but there are edge cases" — confidence will be 0.7, not > 0.7
    expect(shouldAutoChain('code-assistant', 'completed, but there are edge cases')).toBe(false);
  });
});
