import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getEngramBrainPath } from '../config/index.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

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

  it('smartRouting defaults to false', () => {
    delete process.env['KOA_SMART_ROUTING'];
    expect(loadConfig('/tmp').smartRouting).toBe(false);
  });

  it('enables smartRouting when KOA_SMART_ROUTING=true', () => {
    process.env['KOA_SMART_ROUTING'] = 'true';
    expect(loadConfig('/tmp').smartRouting).toBe(true);
  });

  it('maxToolOutputChars defaults to 12000', () => {
    delete process.env['KOA_MAX_TOOL_OUTPUT'];
    expect(loadConfig('/tmp').maxToolOutputChars).toBe(12000);
  });

  it('respects KOA_MAX_TOOL_OUTPUT override', () => {
    process.env['KOA_MAX_TOOL_OUTPUT'] = '5000';
    expect(loadConfig('/tmp').maxToolOutputChars).toBe(5000);
  });

  it('compactAfterTurns defaults to 10', () => {
    delete process.env['KOA_COMPACT_TURNS'];
    expect(loadConfig('/tmp').compactAfterTurns).toBe(10);
  });

  it('respects KOA_COMPACT_TURNS override', () => {
    process.env['KOA_COMPACT_TURNS'] = '20';
    expect(loadConfig('/tmp').compactAfterTurns).toBe(20);
  });
});

describe('auto-checkpoint config', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-cfg-test-'));
    process.env['KOA_HOME'] = tmpDir;
    delete process.env['KOA_CHECKPOINT_TURNS'];
    delete process.env['KOA_CHECKPOINT_MINUTES'];
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('autoCheckpointTurns defaults to 5', () => {
    expect(loadConfig('/tmp').autoCheckpointTurns).toBe(5);
  });

  it('autoCheckpointMinutes defaults to 15', () => {
    expect(loadConfig('/tmp').autoCheckpointMinutes).toBe(15);
  });

  it('KOA_CHECKPOINT_TURNS=0 yields 0', () => {
    process.env['KOA_CHECKPOINT_TURNS'] = '0';
    expect(loadConfig('/tmp').autoCheckpointTurns).toBe(0);
  });

  it('KOA_CHECKPOINT_MINUTES=30 yields 30', () => {
    process.env['KOA_CHECKPOINT_MINUTES'] = '30';
    expect(loadConfig('/tmp').autoCheckpointMinutes).toBe(30);
  });

  it('reads autoCheckpointTurns from config.json', () => {
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(path.join(koaDir, 'config.json'), JSON.stringify({ autoCheckpointTurns: 10 }));
    expect(loadConfig('/tmp').autoCheckpointTurns).toBe(10);
  });

  it('env var overrides config.json', () => {
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(path.join(koaDir, 'config.json'), JSON.stringify({ autoCheckpointTurns: 10 }));
    process.env['KOA_CHECKPOINT_TURNS'] = '2';
    expect(loadConfig('/tmp').autoCheckpointTurns).toBe(2);
  });

  it('invalid JSON in config.json falls back to default', () => {
    const koaDir = path.join(tmpDir, '.koa');
    fs.mkdirSync(koaDir, { recursive: true });
    fs.writeFileSync(path.join(koaDir, 'config.json'), 'not json {{{');
    expect(loadConfig('/tmp').autoCheckpointTurns).toBe(5);
  });

  it('missing config.json does not throw', () => {
    expect(() => loadConfig('/tmp')).not.toThrow();
  });
});

describe('getEngramBrainPath', () => {
  it('uses only the project basename as the slug (matches Engram Python logic)', () => {
    const result = getEngramBrainPath('/Users/ralph/projects/koa');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'koa', 'brain.db'));
  });

  it('lowercases the basename', () => {
    const result = getEngramBrainPath('/projects/MyProject');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'myproject', 'brain.db'));
  });

  it('replaces spaces in basename with hyphens', () => {
    const result = getEngramBrainPath('/Users/ralph/active projects/koa');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'koa', 'brain.db'));
  });

  it('maps a project with spaces in its own name correctly', () => {
    const result = getEngramBrainPath('/projects/my cool app');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'my-cool-app', 'brain.db'));
  });
});
