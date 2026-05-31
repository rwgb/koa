import { describe, it, expect } from 'vitest';
import { EngramClient } from '../engram/client.js';
import type { EngramContext } from '../types/index.js';

// Only test the pure buildSystemPromptInjection method — no filesystem/process calls
const client = new EngramClient('/tmp/fake-project');

describe('EngramClient.buildSystemPromptInjection', () => {
  it('returns empty string for empty context', () => {
    const ctx: EngramContext = { hotFiles: [], masterFiles: [] };
    expect(client.buildSystemPromptInjection(ctx)).toBe('');
  });

  it('includes goal when present', () => {
    const ctx: EngramContext = { goal: 'Build the Koa CLI', hotFiles: [], masterFiles: [] };
    const result = client.buildSystemPromptInjection(ctx);
    expect(result).toContain('Build the Koa CLI');
    expect(result).toContain('<engram_context>');
  });

  it('includes hot files', () => {
    const ctx: EngramContext = {
      hotFiles: [{ path: 'src/agent/loop.ts', score: 0.95 }],
      masterFiles: [],
    };
    const result = client.buildSystemPromptInjection(ctx);
    expect(result).toContain('src/agent/loop.ts');
    expect(result).toContain('Hot Files');
  });

  it('includes cluster label when present', () => {
    const ctx: EngramContext = {
      hotFiles: [{ path: 'src/server/index.ts', score: 0.8, cluster: 'server' }],
      masterFiles: [],
    };
    const result = client.buildSystemPromptInjection(ctx);
    expect(result).toContain('[server]');
  });

  it('caps hot files at 10', () => {
    const hotFiles = Array.from({ length: 15 }, (_, i) => ({
      path: `src/file${i}.ts`,
      score: 1 - i * 0.05,
    }));
    const ctx: EngramContext = { hotFiles, masterFiles: [] };
    const result = client.buildSystemPromptInjection(ctx);
    const matches = result.match(/src\/file\d+\.ts/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(10);
  });

  it('includes session summary', () => {
    const ctx: EngramContext = {
      hotFiles: [],
      masterFiles: [],
      sessionSummary: 'Fixed the execaCommand bug',
    };
    const result = client.buildSystemPromptInjection(ctx);
    expect(result).toContain('Fixed the execaCommand bug');
    expect(result).toContain('Previous Session');
  });

  it('wraps output in engram_context tags', () => {
    const ctx: EngramContext = { goal: 'Ship it', hotFiles: [], masterFiles: [] };
    const result = client.buildSystemPromptInjection(ctx);
    expect(result).toMatch(/^<engram_context>/);
    expect(result).toMatch(/<\/engram_context>$/);
  });
});
