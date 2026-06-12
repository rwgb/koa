import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execa } from 'execa';
import { readCredentials } from '../config/credentials.js';
import { validateSafeUrl } from '../utils/ssrf.js';

export interface UpdateOptions {
  /** Repo root to operate on. Defaults to the root of this installation. */
  repoRoot?: string;
  /** Only report whether an update is available — make no changes. */
  check?: boolean;
  /** Run the vitest suite after building (default true). */
  test?: boolean;
  /** Proceed past dirty-worktree / no-upstream-changes guards. */
  force?: boolean;
  /** Progress logger (defaults to silent). */
  log?: (msg: string) => void;
}

export interface UpdateResult {
  status: 'up-to-date' | 'update-available' | 'updated' | 'rolled-back' | 'blocked' | 'error';
  message: string;
}

// This module lives at <root>/src/updater or <root>/dist/updater — root is two levels up.
function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout.trim();
}

/** Collapses an execa/git failure into a clean one-line message (no stack trace). */
function gitErrorMessage(err: unknown): string {
  const firstLine = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
  return `git command failed: ${firstLine}`;
}

/** True if `ancestor` is an ancestor of (or equal to) `descendant`. */
async function isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean> {
  const result = await execa('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    reject: false,
  });
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw new Error(result.stderr || `git merge-base exited with code ${result.exitCode}`);
}

// ntfy ping following the ~/.koa/credentials NTFY_TOPIC convention (same as
// `koa setup` and the admin /ntfy/test route). No-ops if not configured; a
// notification failure must never break or roll back the update itself.
async function sendNtfy(title: string, body: string): Promise<void> {
  const creds = readCredentials();
  const topic = creds['NTFY_TOPIC'];
  if (!topic) return;
  const baseUrl = creds['NTFY_BASE_URL'] ?? 'https://ntfy.sh';
  try {
    validateSafeUrl(baseUrl);
  } catch {
    return;
  }
  try {
    await fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'Title': title },
      body,
    });
  } catch {
    // best-effort only
  }
}

export async function runUpdate(opts: UpdateOptions = {}): Promise<UpdateResult> {
  const repoRoot = opts.repoRoot ?? defaultRepoRoot();
  const log = opts.log ?? (() => {});
  const runTests = opts.test ?? true;

  // Resolve the configured upstream of the current branch — we only ever pull
  // from it, never from an arbitrary remote.
  let upstream: string;
  try {
    upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoRoot);
  } catch {
    return {
      status: 'error',
      message:
        'No upstream configured for the current branch. ' +
        'Set one with: git branch --set-upstream-to=<remote>/<branch>',
    };
  }
  const slash = upstream.indexOf('/');
  const remote = upstream.slice(0, slash);
  const remoteBranch = upstream.slice(slash + 1);
  if (!remote || !remoteBranch) {
    return { status: 'error', message: `Could not parse upstream "${upstream}".` };
  }

  log(`Checking ${upstream} for updates…`);
  try {
    await execa('git', ['fetch', remote, remoteBranch], { cwd: repoRoot });
  } catch {
    return { status: 'error', message: `Could not fetch from ${upstream}. Check your network and remote access.` };
  }

  let localHead: string;
  let remoteHead: string;
  let updateAvailable: boolean;
  try {
    localHead = await git(['rev-parse', 'HEAD'], repoRoot);
    remoteHead = await git(['rev-parse', upstream], repoRoot);
    // A local branch that is ahead of upstream (dev installs) already contains the
    // remote head — only report an update when the remote has commits we lack.
    updateAvailable = !(await isAncestor(remoteHead, localHead, repoRoot));
  } catch (err) {
    return { status: 'error', message: gitErrorMessage(err) };
  }
  const shortRemote = remoteHead.slice(0, 7);

  if (opts.check) {
    return updateAvailable
      ? {
          status: 'update-available',
          message: `Update available: ${localHead.slice(0, 7)} → ${shortRemote} (${upstream}). Run 'koa update' to apply.`,
        }
      : { status: 'up-to-date', message: `Already up to date with ${upstream}.` };
  }

  let dirty: string;
  try {
    dirty = await git(['status', '--porcelain'], repoRoot);
  } catch (err) {
    return { status: 'error', message: gitErrorMessage(err) };
  }
  if (dirty !== '' && !opts.force) {
    return {
      status: 'blocked',
      message: 'Working tree has uncommitted changes. Commit or stash them first, or re-run with --force.',
    };
  }

  if (!updateAvailable && !opts.force) {
    return { status: 'up-to-date', message: `Already up to date with ${upstream}.` };
  }

  // Snapshot the installed build so a failed update can be rolled back.
  const distDir = path.join(repoRoot, 'dist');
  const backupDir = path.join(repoRoot, 'dist.bak');
  const hasSnapshot = fs.existsSync(distDir);
  if (hasSnapshot) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.cpSync(distDir, backupDir, { recursive: true });
  }

  if (updateAvailable) {
    log(`Pulling ${upstream}…`);
    try {
      await execa('git', ['pull', '--ff-only', remote, remoteBranch], { cwd: repoRoot });
    } catch {
      // No build ran yet — dist/ is untouched, so just drop the snapshot.
      fs.rmSync(backupDir, { recursive: true, force: true });
      return {
        status: 'error',
        message: `git pull from ${upstream} failed (non-fast-forward history or network error). Resolve manually and retry.`,
      };
    }
  }

  let step = 'build';
  try {
    log('Building…');
    await execa('npm', ['run', 'build'], { cwd: repoRoot });
    if (runTests) {
      step = 'test verification';
      log('Running test suite…');
      await execa('npm', ['test'], { cwd: repoRoot });
    }
  } catch {
    if (hasSnapshot) {
      fs.rmSync(distDir, { recursive: true, force: true });
      fs.renameSync(backupDir, distDir);
    }
    await sendNtfy(
      'Koa update rolled back',
      `Update to ${shortRemote} failed during ${step} — previous build restored.`,
    );
    return {
      status: 'rolled-back',
      message:
        `Update failed during ${step} — the previous dist/ build was restored and the CLI keeps working. ` +
        `The source tree is at ${shortRemote}; inspect and fix before retrying.`,
    };
  }

  fs.rmSync(backupDir, { recursive: true, force: true });
  const verified = runTests ? 'build and tests passed' : 'build passed (tests skipped)';
  await sendNtfy('Koa updated', `Updated to ${shortRemote} from ${upstream} — ${verified}.`);
  return { status: 'updated', message: `Updated to ${shortRemote} from ${upstream} — ${verified}.` };
}
