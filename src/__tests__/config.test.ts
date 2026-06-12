import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getEngramBrainPath, validateClaudeCodePath } from '../config/index.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

describe('loadConfig', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Point KOA_HOME at a fresh empty dir so tests never read the real ~/.koa/config.json
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-cfg-test-'));
    process.env['KOA_HOME'] = tmpDir;
    // validateConfig requires an API key when provider=anthropic (the default)
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses defaults when env vars are absent', () => {
    delete process.env['KOA_MODEL'];
    delete process.env['KOA_MAX_TOKENS'];
    delete process.env['KOA_ENGRAM'];

    const config = loadConfig('/tmp/project');
    expect(config.model).toBe('claude-haiku-4-5-20251001');
    expect(config.maxTokens).toBe(8192);
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

});
describe('validateConfig via loadConfig', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-cfg-validate-'));
    process.env['KOA_HOME'] = tmpDir;
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['KOA_PROVIDER'];
    delete process.env['KOA_MAX_TOKENS'];
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('anthropic provider with no API key throws with koa config set hint', () => {
    process.env['KOA_PROVIDER'] = 'anthropic';
    expect(() => loadConfig('/tmp')).toThrow(/koa config set api-key/);
  });

  it('ollama provider with no API key does not throw', () => {
    process.env['KOA_PROVIDER'] = 'ollama';
    expect(() => loadConfig('/tmp')).not.toThrow();
  });

  it('KOA_MAX_TOKENS=abc throws mentioning KOA_MAX_TOKENS', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['KOA_MAX_TOKENS'] = 'abc';
    expect(() => loadConfig('/tmp')).toThrow(/KOA_MAX_TOKENS/);
  });

  it('no config/env -> maxTokens defaults to 8192', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    const config = loadConfig('/tmp');
    expect(config.maxTokens).toBe(8192);
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
    // validateConfig requires an API key when provider=anthropic (the default)
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
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

describe('validateClaudeCodePath', () => {
  it('rejects /etc/passwd — not a claude binary', () => {
    expect(() => validateClaudeCodePath('/etc/passwd')).toThrow(/KOA_CLAUDE_CODE_PATH/);
  });

  it('rejects a relative path', () => {
    expect(() => validateClaudeCodePath('relative/path')).toThrow(/KOA_CLAUDE_CODE_PATH/);
  });

  it('rejects a path with shell metacharacters', () => {
    expect(() => validateClaudeCodePath('/usr/local/bin/claude;rm -rf /')).toThrow(
      /KOA_CLAUDE_CODE_PATH/,
    );
  });

  it('accepts /usr/local/bin/claude', () => {
    expect(() => validateClaudeCodePath('/usr/local/bin/claude')).not.toThrow();
  });

  it('accepts /usr/local/bin/claude-code', () => {
    expect(() => validateClaudeCodePath('/usr/local/bin/claude-code')).not.toThrow();
  });
});

describe('KOA_CLAUDE_CODE_PATH validation in loadConfig', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-cfg-claudepath-'));
    process.env['KOA_HOME'] = tmpDir;
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    process.env['KOA_PROVIDER'] = 'claude-code';
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('KOA_CLAUDE_CODE_PATH=/etc/passwd throws mentioning KOA_CLAUDE_CODE_PATH', () => {
    process.env['KOA_CLAUDE_CODE_PATH'] = '/etc/passwd';
    expect(() => loadConfig('/tmp')).toThrow(/KOA_CLAUDE_CODE_PATH/);
  });

  it('KOA_CLAUDE_CODE_PATH=relative/path throws mentioning KOA_CLAUDE_CODE_PATH', () => {
    process.env['KOA_CLAUDE_CODE_PATH'] = 'relative/path';
    expect(() => loadConfig('/tmp')).toThrow(/KOA_CLAUDE_CODE_PATH/);
  });

  it('KOA_CLAUDE_CODE_PATH=/usr/local/bin/claude does not throw', () => {
    process.env['KOA_CLAUDE_CODE_PATH'] = '/usr/local/bin/claude';
    expect(() => loadConfig('/tmp')).not.toThrow();
  });

  it('KOA_CLAUDE_CODE_PATH=/usr/local/bin/claude-code does not throw', () => {
    process.env['KOA_CLAUDE_CODE_PATH'] = '/usr/local/bin/claude-code';
    expect(() => loadConfig('/tmp')).not.toThrow();
  });
});

describe('getEngramBrainPath', () => {
  it('uses only the project basename as the slug (matches Engram Python logic)', () => {
    const result = getEngramBrainPath('/home/user/projects/koa');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'koa', 'brain.db'));
  });

  it('lowercases the basename', () => {
    const result = getEngramBrainPath('/projects/MyProject');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'myproject', 'brain.db'));
  });

  it('replaces spaces in basename with hyphens', () => {
    const result = getEngramBrainPath('/home/user/active projects/koa');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'koa', 'brain.db'));
  });

  it('maps a project with spaces in its own name correctly', () => {
    const result = getEngramBrainPath('/projects/my cool app');
    expect(result).toBe(path.join(os.homedir(), '.engram', 'brains', 'my-cool-app', 'brain.db'));
  });
});
