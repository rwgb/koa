import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getEngramBrainPath } from '../config/index.js';
import os from 'os';
import path from 'path';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses defaults when env vars are absent', () => {
    delete process.env['KOA_MODEL'];
    delete process.env['KOA_MAX_TOKENS'];
    delete process.env['KOA_ENGRAM'];

    const config = loadConfig('/tmp/project');
    expect(config.model).toBe('claude-sonnet-4-6');
    expect(config.maxTokens).toBe(8096);
    expect(config.engramEnabled).toBe(true);
    expect(config.projectPath).toBe('/tmp/project');
  });

  it('respects KOA_MODEL override', () => {
    process.env['KOA_MODEL'] = 'claude-opus-4-7';
    expect(loadConfig('/tmp').model).toBe('claude-opus-4-7');
  });

  it('respects KOA_MAX_TOKENS override', () => {
    process.env['KOA_MAX_TOKENS'] = '4096';
    expect(loadConfig('/tmp').maxTokens).toBe(4096);
  });

  it('disables engram when KOA_ENGRAM=false', () => {
    process.env['KOA_ENGRAM'] = 'false';
    expect(loadConfig('/tmp').engramEnabled).toBe(false);
  });

  it('defaults projectPath to cwd when not provided', () => {
    const config = loadConfig();
    expect(config.projectPath).toBe(process.cwd());
  });

  it('picks up ANTHROPIC_API_KEY', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key';
    expect(loadConfig('/tmp').apiKey).toBe('sk-test-key');
  });
});

describe('getEngramBrainPath', () => {
  it('builds a slug-based path under ~/.engram/brains/', () => {
    const result = getEngramBrainPath('/Users/ralph/projects/koa');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'Users-ralph-projects-koa', 'brain.db'));
  });

  it('strips leading/trailing hyphens from slug', () => {
    const result = getEngramBrainPath('/foo/bar');
    expect(result).toContain('foo-bar');
    const slug = path.basename(path.dirname(result));
    expect(slug).not.toMatch(/^-|-$/);
  });
});
