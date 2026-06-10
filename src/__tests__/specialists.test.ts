import { describe, it, expect } from 'vitest';
import { buildAgentSpecs } from '../agent/specialists.js';

describe('buildAgentSpecs(userName)', () => {
  it('injects userName into life-manager systemAddition', () => {
    const specs = buildAgentSpecs('Alice');
    expect(specs['life-manager'].systemAddition).toContain('Alice');
  });

  it('does not inject userName into code-assistant system', () => {
    const specs = buildAgentSpecs('Alice');
    expect(specs['code-assistant'].systemAddition).not.toContain('Alice');
  });

  it('defaults to User when given User', () => {
    const specs = buildAgentSpecs('User');
    expect(specs['life-manager'].systemAddition).toContain('User');
  });
});
