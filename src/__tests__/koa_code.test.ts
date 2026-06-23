/**
 * Tests for the `koa code` subcommand behaviour.
 *
 * We test only the config/filesystem layer (loadLocalConfig, ensureLocalHome,
 * koaLocalDir) and the CLAUDE.md injection logic — not the full agent startup.
 * AgentLoop and App are vi.mock'd to avoid network/filesystem side-effects.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { loadLocalConfig, ensureLocalHome, koaLocalDir } from '../config/index.js';

// ---------------------------------------------------------------------------
// Minimal module mocks so importing cli/index.ts from other tests doesn't
// pull in the full agent/App/Ink stack.  These are not exercised directly in
// this file but are required by config/index.ts transitive imports.
// ---------------------------------------------------------------------------
vi.mock('../agent/loop.js', () => ({
  AgentLoop: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue({ engramContext: null, projectMemory: {} }),
    finalize: vi.fn().mockResolvedValue(undefined),
    turn: vi.fn().mockResolvedValue({ content: '' }),
  })),
}));

vi.mock('../tui/App.js', () => ({
  App: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared env isolation helpers
// ---------------------------------------------------------------------------
const originalEnv = process.env;

function isolateEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env = { ...originalEnv, ...overrides };
}

function restoreEnv(): void {
  process.env = originalEnv;
}

// ---------------------------------------------------------------------------
// koaLocalDir() — respects KOA_LOCAL_HOME
// ---------------------------------------------------------------------------
describe('koaLocalDir()', () => {
  afterEach(restoreEnv);

  it('defaults to ~/.koa-local when KOA_LOCAL_HOME is not set', () => {
    isolateEnv({ KOA_LOCAL_HOME: undefined });
    delete process.env['KOA_LOCAL_HOME'];
    expect(koaLocalDir()).toBe(path.join(os.homedir(), '.koa-local'));
  });

  it('returns KOA_LOCAL_HOME verbatim when set', () => {
    isolateEnv({ KOA_LOCAL_HOME: '/custom/local/home' });
    expect(koaLocalDir()).toBe('/custom/local/home');
  });
});

// ---------------------------------------------------------------------------
// ensureLocalHome() — creates directory tree
// ---------------------------------------------------------------------------
describe('ensureLocalHome()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-local-home-'));
    fs.rmSync(tmpDir, { recursive: true, force: true }); // start with it absent
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the localHome and projects/ subdirectory when absent', () => {
    expect(fs.existsSync(tmpDir)).toBe(false);
    ensureLocalHome(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'projects'))).toBe(true);
  });

  it('is idempotent — does not throw when called a second time', () => {
    ensureLocalHome(tmpDir);
    expect(() => ensureLocalHome(tmpDir)).not.toThrow();
  });

  it('creates directories with mode 0o700', () => {
    ensureLocalHome(tmpDir);
    const stat = fs.statSync(path.join(tmpDir, 'projects'));
    // On macOS/Linux the mode includes the type bits; mask to permission bits only.
    expect(stat.mode & 0o777).toBe(0o700);
  });
});

// ---------------------------------------------------------------------------
// loadLocalConfig() — project root resolution
// ---------------------------------------------------------------------------
describe('loadLocalConfig() — project root resolution', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-lcfg-'));
    isolateEnv({
      KOA_LOCAL_HOME: tmpHome,
      ANTHROPIC_API_KEY: 'sk-test',
      KOA_PROVIDER: undefined,
    });
    delete process.env['KOA_PROVIDER'];
    ensureLocalHome(tmpHome);
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('uses process.cwd() as projectPath when no argument is supplied', () => {
    const config = loadLocalConfig();
    expect(config.projectPath).toBe(process.cwd());
  });

  it('uses the provided directory as projectPath', () => {
    const config = loadLocalConfig('/some/project/dir');
    expect(config.projectPath).toBe('/some/project/dir');
  });

  it('sets localHome to the KOA_LOCAL_HOME value, not the default ~/.koa/', () => {
    const config = loadLocalConfig('/tmp/proj');
    expect(config.localHome).toBe(tmpHome);
  });
});

// ---------------------------------------------------------------------------
// loadLocalConfig() — KOA_LOCAL_HOME isolation from server KOA_HOME
// ---------------------------------------------------------------------------
describe('loadLocalConfig() — KOA_LOCAL_HOME isolation', () => {
  let tmpLocal: string;
  let tmpServer: string;

  beforeEach(() => {
    tmpLocal = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-local-'));
    tmpServer = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-server-'));
    isolateEnv({
      KOA_LOCAL_HOME: tmpLocal,
      KOA_HOME: tmpServer,
      ANTHROPIC_API_KEY: 'sk-server-key',
    });
    ensureLocalHome(tmpLocal);

    // Write a different API key into the local credentials file
    fs.writeFileSync(
      path.join(tmpLocal, 'credentials'),
      'ANTHROPIC_API_KEY=sk-local-key\n',
      { mode: 0o600 },
    );
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(tmpLocal, { recursive: true, force: true });
    fs.rmSync(tmpServer, { recursive: true, force: true });
  });

  it('reads apiKey from localHome/credentials, not from the server KOA_HOME', () => {
    // Remove the env var so only the credentials files are in play
    delete process.env['ANTHROPIC_API_KEY'];
    const config = loadLocalConfig('/tmp/proj');
    expect(config.apiKey).toBe('sk-local-key');
  });

  it('disables Engram in local config', () => {
    const config = loadLocalConfig('/tmp/proj');
    expect(config.engramEnabled).toBe(false);
  });

  it('disables auto-checkpoint in local config', () => {
    const config = loadLocalConfig('/tmp/proj');
    expect(config.autoCheckpointTurns).toBe(0);
    expect(config.autoCheckpointMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md injection — tests the file-read + state mutation logic in isolation
// ---------------------------------------------------------------------------
describe('CLAUDE.md injection (unit)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-claudemd-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function injectClaudeMd(
    targetDir: string,
    existingProjectMemory: string | undefined,
  ): string | undefined {
    // Mirror the exact injection logic from cli/index.ts `koa code` action
    const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
    let projectMemory: string | undefined = existingProjectMemory;
    try {
      const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
      const existing = projectMemory ?? '';
      const separator = existing ? '\n\n---\n\n' : '';
      projectMemory = `<local_instructions source="CLAUDE.md">\n${claudeMdContent}\n</local_instructions>${separator}${existing}`;
    } catch {
      // CLAUDE.md not present — continue without it.
    }
    return projectMemory;
  }

  it('injects CLAUDE.md content wrapped in <local_instructions> when present', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# My Project\nDo the thing.');
    const result = injectClaudeMd(tmpDir, undefined);
    expect(result).toContain('<local_instructions source="CLAUDE.md">');
    expect(result).toContain('# My Project');
    expect(result).toContain('</local_instructions>');
  });

  it('prepends CLAUDE.md before existing projectMemory', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'CLAUDE content');
    const existing = 'Existing memory block';
    const result = injectClaudeMd(tmpDir, existing);
    const claudePos = result!.indexOf('<local_instructions');
    const existingPos = result!.indexOf('Existing memory block');
    expect(claudePos).toBeLessThan(existingPos);
  });

  it('adds separator between CLAUDE.md and existing memory', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Instructions');
    const result = injectClaudeMd(tmpDir, 'prior content');
    expect(result).toContain('\n\n---\n\n');
  });

  it('returns undefined (no mutation) when CLAUDE.md is absent', () => {
    // No CLAUDE.md written — tmpDir is empty
    const result = injectClaudeMd(tmpDir, undefined);
    expect(result).toBeUndefined();
  });

  it('does not add separator when there is no pre-existing memory', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Instructions');
    const result = injectClaudeMd(tmpDir, undefined);
    expect(result).not.toContain('---');
  });
});
