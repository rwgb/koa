import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, loadLocalConfig, ensureLocalHome, koaLocalDir, getEngramBrainPath, validateClaudeCodePath } from '../config/index.js';
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

  it('smartRouting defaults to true', () => {
    delete process.env['KOA_SMART_ROUTING'];
    expect(loadConfig('/tmp').smartRouting).toBe(true);
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

describe('koaLocalDir', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to ~/.koa-local when KOA_LOCAL_HOME is unset', () => {
    delete process.env['KOA_LOCAL_HOME'];
    expect(koaLocalDir()).toBe(path.join(os.homedir(), '.koa-local'));
  });

  it('uses KOA_LOCAL_HOME when set', () => {
    process.env['KOA_LOCAL_HOME'] = '/custom/local';
    expect(koaLocalDir()).toBe('/custom/local');
  });

  it('does NOT use KOA_HOME — local dir is independent of the server dir', () => {
    process.env['KOA_HOME'] = '/some/server/home';
    delete process.env['KOA_LOCAL_HOME'];
    // koaLocalDir() must not be influenced by KOA_HOME
    expect(koaLocalDir()).toBe(path.join(os.homedir(), '.koa-local'));
  });
});

describe('ensureLocalHome', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-local-home-test-'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the localHome directory and projects subdirectory', () => {
    ensureLocalHome(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'projects'))).toBe(true);
  });

  it('is idempotent — does not throw when called twice', () => {
    ensureLocalHome(tmpDir);
    expect(() => ensureLocalHome(tmpDir)).not.toThrow();
  });
});

describe('loadLocalConfig', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-local-cfg-test-'));
    process.env['KOA_LOCAL_HOME'] = tmpDir;
    ensureLocalHome(tmpDir);
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets localHome to the KOA_LOCAL_HOME path', () => {
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.localHome).toBe(tmpDir);
  });

  it('sets projectPath to the provided path', () => {
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.projectPath).toBe('/tmp/myproject');
  });

  it('defaults projectPath to cwd when not provided', () => {
    const config = loadLocalConfig();
    expect(config.projectPath).toBe(process.cwd());
  });

  it('disables Engram by default', () => {
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.engramEnabled).toBe(false);
  });

  it('disables auto-checkpoints by default', () => {
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.autoCheckpointTurns).toBe(0);
    expect(config.autoCheckpointMinutes).toBe(0);
  });

  it('disables browser by default', () => {
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.browserEnabled).toBe(false);
  });

  it('reads config.json from localHome not from ~/.koa/', () => {
    // Write a local config.json with a custom model
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ model: 'claude-sonnet-4-6' }),
    );
    // Also write a server config.json with a different model (should be ignored)
    const serverHome = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-server-cfg-'));
    try {
      process.env['KOA_HOME'] = serverHome;
      fs.mkdirSync(path.join(serverHome, '.koa'), { recursive: true });
      fs.writeFileSync(
        path.join(serverHome, '.koa', 'config.json'),
        JSON.stringify({ model: 'claude-haiku-4-5-20251001' }),
      );
      const config = loadLocalConfig('/tmp/myproject');
      // Should use local config model, not server model
      expect(config.model).toBe('claude-sonnet-4-6');
    } finally {
      fs.rmSync(serverHome, { recursive: true, force: true });
    }
  });

  it('reads API key from localHome/credentials when not in env', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    fs.writeFileSync(
      path.join(tmpDir, 'credentials'),
      'ANTHROPIC_API_KEY=sk-local-key\n',
      { mode: 0o600 },
    );
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.apiKey).toBe('sk-local-key');
  });

  it('env var ANTHROPIC_API_KEY takes precedence over local credentials file', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-env-key';
    fs.writeFileSync(
      path.join(tmpDir, 'credentials'),
      'ANTHROPIC_API_KEY=sk-local-key\n',
      { mode: 0o600 },
    );
    const config = loadLocalConfig('/tmp/myproject');
    expect(config.apiKey).toBe('sk-env-key');
  });

  it('does NOT read credentials from KOA_HOME/.koa/credentials', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    // Write the key only to the server credentials location
    const serverHome = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-server-creds-'));
    try {
      const serverKoaDir = path.join(serverHome, '.koa');
      process.env['KOA_HOME'] = serverHome;
      fs.mkdirSync(serverKoaDir, { recursive: true });
      fs.writeFileSync(
        path.join(serverKoaDir, 'credentials'),
        'ANTHROPIC_API_KEY=sk-server-key\n',
        { mode: 0o600 },
      );
      // loadLocalConfig should NOT find sk-server-key since it reads localHome/credentials
      process.env['KOA_PROVIDER'] = 'ollama'; // avoid apiKey validation throwing
      const config = loadLocalConfig('/tmp/myproject');
      expect(config.apiKey).toBeUndefined();
    } finally {
      fs.rmSync(serverHome, { recursive: true, force: true });
      delete process.env['KOA_PROVIDER'];
    }
  });
});
