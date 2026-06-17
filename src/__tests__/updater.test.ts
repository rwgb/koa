import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock execa before importing the updater (same pattern as bash_tool.test.ts).
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { runUpdate } from '../updater/index.js';
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

const LOCAL_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REMOTE_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let tmpDir: string;
let repoRoot: string;
let distDir: string;
let backupDir: string;
let fetchMock: ReturnType<typeof vi.fn>;
let origKoaHome: string | undefined;

interface ExecaScenario {
  upstream?: string | null; // null = no upstream configured
  remoteHead?: string;
  localAhead?: boolean; // remote head is an ancestor of local HEAD (dev install ahead of upstream)
  dirty?: boolean;
  pullFails?: boolean;
  buildFails?: boolean;
  testsFail?: boolean;
}

// Records every invocation as [cmd, ...args] and simulates git/npm behaviour.
function setupExeca(scenario: ExecaScenario): string[][] {
  const calls: string[][] = [];
  mockExeca.mockImplementation(((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const joined = args.join(' ');
    if (cmd === 'git') {
      if (joined.includes('@{u}')) {
        if (scenario.upstream === null) return Promise.reject(new Error('no upstream'));
        return Promise.resolve({ stdout: scenario.upstream ?? 'origin/main' });
      }
      if (args[0] === 'fetch') return Promise.resolve({ stdout: '' });
      if (joined === 'rev-parse HEAD') return Promise.resolve({ stdout: LOCAL_SHA });
      if (args[0] === 'rev-parse') return Promise.resolve({ stdout: scenario.remoteHead ?? REMOTE_SHA });
      if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
        // exit 0 = remote head is an ancestor of (or equal to) local HEAD → no update.
        const remoteContained = args[2] === LOCAL_SHA || scenario.localAhead === true;
        return Promise.resolve({ exitCode: remoteContained ? 0 : 1, stdout: '', stderr: '' });
      }
      if (args[0] === 'status') return Promise.resolve({ stdout: scenario.dirty ? ' M src/x.ts' : '' });
      if (args[0] === 'pull') {
        if (scenario.pullFails) return Promise.reject(new Error('pull failed'));
        return Promise.resolve({ stdout: '' });
      }
    }
    if (cmd === 'npm') {
      if (args[0] === 'run' && args[1] === 'build') {
        if (scenario.buildFails) return Promise.reject(new Error('tsc failed'));
        // Simulate the build replacing dist/ contents.
        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(distDir, 'marker.txt'), 'new-build');
        return Promise.resolve({ stdout: '' });
      }
      if (args[0] === 'test') {
        if (scenario.testsFail) return Promise.reject(new Error('vitest failed'));
        return Promise.resolve({ stdout: '' });
      }
    }
    return Promise.reject(new Error(`unexpected command: ${cmd} ${joined}`));
  }) as never);
  return calls;
}

function writeOldDist(): void {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'marker.txt'), 'old-build');
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-updater-test-'));
  repoRoot = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  distDir = path.join(repoRoot, 'dist');
  backupDir = path.join(repoRoot, 'dist.bak');

  // Point ~/.koa at the temp dir and configure an ntfy topic so pings are observable.
  origKoaHome = process.env['KOA_HOME'];
  process.env['KOA_HOME'] = tmpDir;
  fs.mkdirSync(path.join(tmpDir, '.koa'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.koa', 'credentials'), 'NTFY_TOPIC=test-topic\n');

  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (origKoaHome === undefined) delete process.env['KOA_HOME'];
  else process.env['KOA_HOME'] = origKoaHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('koa update', () => {
  it('--check reports an available update without making changes', async () => {
    writeOldDist();
    const calls = setupExeca({});
    const result = await runUpdate({ repoRoot, check: true });

    expect(result.status).toBe('update-available');
    expect(result.message).toContain('origin/main');
    // No pull, no build, no test, dist untouched.
    expect(calls.some(c => c[1] === 'pull')).toBe(false);
    expect(calls.some(c => c[0] === 'npm')).toBe(false);
    expect(fs.readFileSync(path.join(distDir, 'marker.txt'), 'utf8')).toBe('old-build');
  });

  it('--check reports up-to-date when local HEAD matches upstream', async () => {
    setupExeca({ remoteHead: LOCAL_SHA });
    const result = await runUpdate({ repoRoot, check: true });
    expect(result.status).toBe('up-to-date');
  });

  it('--check treats a local branch ahead of upstream as up-to-date (no downgrade prompt)', async () => {
    setupExeca({ localAhead: true });
    const result = await runUpdate({ repoRoot, check: true });
    expect(result.status).toBe('up-to-date');
  });

  it('happy path: pulls upstream, builds, tests, cleans snapshot, pings ntfy', async () => {
    writeOldDist();
    const calls = setupExeca({});
    const result = await runUpdate({ repoRoot });

    expect(result.status).toBe('updated');
    // Pull is pinned to the configured upstream, array-form args.
    expect(calls).toContainEqual(['git', 'pull', '--ff-only', 'origin', 'main']);
    expect(calls).toContainEqual(['npm', 'run', 'build']);
    expect(calls).toContainEqual(['npm', 'test']);
    // New build kept, snapshot removed.
    expect(fs.readFileSync(path.join(distDir, 'marker.txt'), 'utf8')).toBe('new-build');
    expect(fs.existsSync(backupDir)).toBe(false);
    // Success notification to the credentials-configured topic.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ntfy.sh/test-topic',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Title: 'Koa updated' }),
      }),
    );
  });

  it('rolls back dist/ when the build fails and pings ntfy', async () => {
    writeOldDist();
    setupExeca({ buildFails: true });
    const result = await runUpdate({ repoRoot });

    expect(result.status).toBe('rolled-back');
    expect(result.message).toContain('build');
    // Old build restored, snapshot consumed.
    expect(fs.readFileSync(path.join(distDir, 'marker.txt'), 'utf8')).toBe('old-build');
    expect(fs.existsSync(backupDir)).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ntfy.sh/test-topic',
      expect.objectContaining({
        headers: expect.objectContaining({ Title: 'Koa update rolled back' }),
      }),
    );
  });

  it('rolls back dist/ when test verification fails', async () => {
    writeOldDist();
    setupExeca({ testsFail: true });
    const result = await runUpdate({ repoRoot });

    expect(result.status).toBe('rolled-back');
    expect(result.message).toContain('test verification');
    expect(fs.readFileSync(path.join(distDir, 'marker.txt'), 'utf8')).toBe('old-build');
  });

  it('refuses to update a dirty working tree', async () => {
    writeOldDist();
    const calls = setupExeca({ dirty: true });
    const result = await runUpdate({ repoRoot });

    expect(result.status).toBe('blocked');
    expect(result.message).toContain('--force');
    expect(calls.some(c => c[1] === 'pull')).toBe(false);
    expect(calls.some(c => c[0] === 'npm')).toBe(false);
  });

  it('--force proceeds despite a dirty working tree', async () => {
    writeOldDist();
    const calls = setupExeca({ dirty: true });
    const result = await runUpdate({ repoRoot, force: true });

    expect(result.status).toBe('updated');
    expect(calls).toContainEqual(['git', 'pull', '--ff-only', 'origin', 'main']);
  });

  it('--force rebuilds even when already up to date (skips pull)', async () => {
    writeOldDist();
    const calls = setupExeca({ remoteHead: LOCAL_SHA });
    const result = await runUpdate({ repoRoot, force: true });

    expect(result.status).toBe('updated');
    expect(calls.some(c => c[1] === 'pull')).toBe(false);
    expect(calls).toContainEqual(['npm', 'run', 'build']);
  });

  it('--no-test skips the vitest verification step', async () => {
    writeOldDist();
    const calls = setupExeca({});
    const result = await runUpdate({ repoRoot, test: false });

    expect(result.status).toBe('updated');
    expect(calls.some(c => c[0] === 'npm' && c[1] === 'test')).toBe(false);
    expect(result.message).toContain('tests skipped');
  });

  it('reports up-to-date without building when nothing changed', async () => {
    writeOldDist();
    const calls = setupExeca({ remoteHead: LOCAL_SHA });
    const result = await runUpdate({ repoRoot });

    expect(result.status).toBe('up-to-date');
    expect(calls.some(c => c[0] === 'npm')).toBe(false);
  });

  it('falls back to origin/main when no upstream is configured', async () => {
    setupExeca({ upstream: null });
    const result = await runUpdate({ repoRoot, check: true });

    expect(result.status).not.toBe('error');
    expect(result.message).toContain('origin/main');
  });

  it('drops the snapshot and errors when git pull fails (dist untouched)', async () => {
    writeOldDist();
    setupExeca({ pullFails: true });
    const result = await runUpdate({ repoRoot });

    expect(result.status).toBe('error');
    expect(fs.readFileSync(path.join(distDir, 'marker.txt'), 'utf8')).toBe('old-build');
    expect(fs.existsSync(backupDir)).toBe(false);
  });
});
