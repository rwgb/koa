import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readCredentials, writeCredential, deleteCredential, getCredentialsPath } from '../config/credentials.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-test-'));
  process.env['KOA_HOME'] = tmpDir;
});

afterEach(() => {
  delete process.env['KOA_HOME'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readCredentials', () => {
  it('returns empty object when file does not exist', () => {
    expect(readCredentials()).toEqual({});
  });

  it('parses key=value pairs', () => {
    fs.mkdirSync(path.join(tmpDir, '.koa'));
    fs.writeFileSync(path.join(tmpDir, '.koa', 'credentials'), 'ANTHROPIC_API_KEY=sk-ant-test\n');
    expect(readCredentials()).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test' });
  });

  it('ignores comment lines and blank lines', () => {
    fs.mkdirSync(path.join(tmpDir, '.koa'));
    fs.writeFileSync(
      path.join(tmpDir, '.koa', 'credentials'),
      '# this is a comment\n\nANTHROPIC_API_KEY=sk-ant-test\n',
    );
    expect(readCredentials()).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-test' });
  });
});

describe('writeCredential', () => {
  it('creates ~/.koa directory and credentials file', () => {
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-abc123');
    expect(readCredentials()).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-abc123' });
  });

  it('sets file permissions to 0o600', () => {
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-abc123');
    const stat = fs.statSync(path.join(tmpDir, '.koa', 'credentials'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('overwrites existing key without touching other keys', () => {
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-first');
    writeCredential('OTHER_KEY', 'other-value');
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-second');
    const result = readCredentials();
    expect(result['ANTHROPIC_API_KEY']).toBe('sk-ant-second');
    expect(result['OTHER_KEY']).toBe('other-value');
  });
});

describe('deleteCredential', () => {
  it('removes a key from the credentials file', () => {
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-abc123');
    writeCredential('OTHER_KEY', 'other-value');
    deleteCredential('ANTHROPIC_API_KEY');
    const result = readCredentials();
    expect(result['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(result['OTHER_KEY']).toBe('other-value');
  });

  it('is a no-op when credentials file does not exist', () => {
    expect(() => deleteCredential('ANTHROPIC_API_KEY')).not.toThrow();
  });
});

describe('getCredentialsPath', () => {
  it('returns path under KOA_HOME when set', () => {
    expect(getCredentialsPath()).toBe(path.join(tmpDir, '.koa', 'credentials'));
  });
});

describe('loadConfig credentials fallback', () => {
  it('uses credentials file when ANTHROPIC_API_KEY env var is not set', async () => {
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-from-file');
    const savedEnv = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const { loadConfig } = await import('../config/index.js');
      const config = loadConfig('/tmp');
      expect(config.apiKey).toBe('sk-ant-from-file');
    } finally {
      if (savedEnv !== undefined) process.env['ANTHROPIC_API_KEY'] = savedEnv;
    }
  });

  it('env var takes precedence over credentials file', async () => {
    writeCredential('ANTHROPIC_API_KEY', 'sk-ant-from-file');
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-from-env';
    try {
      const { loadConfig } = await import('../config/index.js');
      const config = loadConfig('/tmp');
      expect(config.apiKey).toBe('sk-ant-from-env');
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });
});
