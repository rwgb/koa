import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-cross-repo-test-'));
});

afterEach(() => {
  delete process.env['KOA_CROSS_REPO_ALLOWLIST'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.resetModules();
});

// Dynamic import with vi.resetModules() ensures the module is re-evaluated
// with the current env var value (mirrors the env-injection pattern but uses
// Vitest's module reset instead of URL cache-busting, which Vitest ignores).
async function getCrossRepoTools(allowlist?: Record<string, string>) {
  if (allowlist) {
    process.env['KOA_CROSS_REPO_ALLOWLIST'] = JSON.stringify(allowlist);
  }
  vi.resetModules();
  const mod = await import('../agent/tools/cross_repo.js');
  return {
    crossRepoReadTool: mod.crossRepoReadTool,
    crossRepoWriteTool: mod.crossRepoWriteTool,
  };
}

describe('cross_repo_write path traversal guard', () => {
  it('rejects relPath containing ..', async () => {
    const { crossRepoWriteTool } = await getCrossRepoTools();
    await expect(
      crossRepoWriteTool.execute({ repo: 'engram', relPath: '../../../etc/passwd', content: 'evil' }),
    ).rejects.toThrow('Path traversal rejected');
  });

  it('rejects unknown repo', async () => {
    const { crossRepoWriteTool } = await getCrossRepoTools();
    await expect(
      crossRepoWriteTool.execute({ repo: 'evil-repo', relPath: 'file.txt', content: 'data' }),
    ).rejects.toThrow('Unknown repo');
  });

  it('rejects unknown repo for read', async () => {
    const { crossRepoReadTool } = await getCrossRepoTools();
    await expect(
      crossRepoReadTool.execute({ repo: 'notallowed', relPath: 'file.txt' }),
    ).rejects.toThrow('Unknown repo');
  });

  it('still rejects .. traversal after symlink-guard refactor (write)', async () => {
    const { crossRepoWriteTool } = await getCrossRepoTools();
    await expect(
      crossRepoWriteTool.execute({ repo: 'engram', relPath: '../../etc/passwd', content: 'evil' }),
    ).rejects.toThrow('Path traversal');
  });

  it('still rejects .. traversal after symlink-guard refactor (read)', async () => {
    const { crossRepoReadTool } = await getCrossRepoTools();
    await expect(
      crossRepoReadTool.execute({ repo: 'engram', relPath: '../../etc/passwd' }),
    ).rejects.toThrow('Path traversal');
  });
});

describe('cross_repo allowlist base path validation', () => {
  it('throws when KOA_CROSS_REPO_ALLOWLIST contains a system directory base path (/etc)', async () => {
    await expect(getCrossRepoTools({ x: '/etc' })).rejects.toThrow(
      'KOA_CROSS_REPO_ALLOWLIST contains unsafe base path: /etc',
    );
  });

  it('throws when KOA_CROSS_REPO_ALLOWLIST contains a nested system path (/etc/passwd)', async () => {
    await expect(getCrossRepoTools({ x: '/etc/passwd' })).rejects.toThrow(
      'KOA_CROSS_REPO_ALLOWLIST contains unsafe base path: /etc/passwd',
    );
  });

  it('throws when KOA_CROSS_REPO_ALLOWLIST contains filesystem root (/)', async () => {
    await expect(getCrossRepoTools({ x: '/' })).rejects.toThrow(
      'KOA_CROSS_REPO_ALLOWLIST contains unsafe base path',
    );
  });

  it('throws when KOA_CROSS_REPO_ALLOWLIST contains a non-absolute path', async () => {
    await expect(getCrossRepoTools({ x: 'relative/path' })).rejects.toThrow(
      'non-absolute base path',
    );
  });
});

describe('cross_repo symlink guard', () => {
  it('rejects a symlink pointing outside the allowed base (e.g. -> /etc)', async () => {
    // Set up a temp repo base and create a symlink inside it that escapes to /etc
    const repoBase = path.join(tmpDir, 'myrepo');
    fs.mkdirSync(repoBase, { recursive: true });
    const symlinkPath = path.join(repoBase, 'evil-link');
    fs.symlinkSync('/etc', symlinkPath);

    const { crossRepoReadTool } = await getCrossRepoTools({ myrepo: repoBase });

    await expect(
      crossRepoReadTool.execute({ repo: 'myrepo', relPath: 'evil-link' }),
    ).rejects.toThrow(/symlink/);
  });

  it('write-then-read in a temp dir succeeds (happy path)', async () => {
    const repoBase = path.join(tmpDir, 'goodrepo');
    fs.mkdirSync(repoBase, { recursive: true });

    const { crossRepoWriteTool, crossRepoReadTool } = await getCrossRepoTools({ goodrepo: repoBase });

    await crossRepoWriteTool.execute({ repo: 'goodrepo', relPath: 'hello.txt', content: 'world' });
    const result = await crossRepoReadTool.execute({ repo: 'goodrepo', relPath: 'hello.txt' });
    expect(result).toBe('world');
  });
});
