import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import type { Tool, ToolInput } from '../../types/index.js';

const SYSTEM_DIR_PREFIXES = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/bin',
  '/sbin',
  '/usr/bin',
  '/usr/sbin',
  '/lib',
  '/lib64',
];

function isUnderSystemPrefix(p: string): boolean {
  if (p === '/') return true;
  for (const prefix of SYSTEM_DIR_PREFIXES) {
    if (p === prefix || p.startsWith(prefix + '/')) return true;
  }
  return false;
}

function validateAllowlistPath(key: string, rawPath: string): void {
  if (!path.isAbsolute(rawPath)) {
    throw new Error(
      `KOA_CROSS_REPO_ALLOWLIST contains non-absolute base path for key "${key}": ${rawPath}`,
    );
  }

  if (rawPath === '/') {
    throw new Error(
      `KOA_CROSS_REPO_ALLOWLIST contains unsafe base path: ${rawPath} — filesystem root is not allowed`,
    );
  }

  // Check the raw (pre-symlink) path first — catches /etc even on macOS where
  // realpathSync('/etc') → '/private/etc', which doesn't match the prefix list.
  if (isUnderSystemPrefix(rawPath)) {
    throw new Error(
      `KOA_CROSS_REPO_ALLOWLIST contains unsafe base path: ${rawPath} — must be within user home or project directory`,
    );
  }

  // Also check the fully resolved path to catch symlinks that redirect INTO a
  // system directory (e.g., a custom symlink pointing at /etc from ~/).
  let resolved: string;
  try {
    resolved = fsSync.realpathSync(rawPath);
  } catch {
    // Path doesn't exist yet — skip resolved check (raw path already passed above).
    return;
  }

  if (resolved === '/') {
    throw new Error(
      `KOA_CROSS_REPO_ALLOWLIST contains unsafe base path: ${rawPath} — filesystem root is not allowed`,
    );
  }

  if (isUnderSystemPrefix(resolved)) {
    throw new Error(
      `KOA_CROSS_REPO_ALLOWLIST contains unsafe base path: ${rawPath} — must be within user home or project directory`,
    );
  }
}

function buildAllowlist(): Record<string, string> {
  const envVal = process.env['KOA_CROSS_REPO_ALLOWLIST'];
  if (envVal) {
    try {
      const parsed = JSON.parse(envVal) as Record<string, string>;
      for (const [key, basePath] of Object.entries(parsed)) {
        validateAllowlistPath(key, basePath);
      }
      return parsed;
    } catch (err) {
      // Re-throw validation errors; swallow JSON parse errors to fall through to default.
      if (err instanceof Error && err.message.includes('KOA_CROSS_REPO_ALLOWLIST')) {
        throw err;
      }
      // fall through to default
    }
  }
  return {
    engram: path.join(os.homedir(), 'active projects/engram'),
  };
}

const ALLOWLIST: Record<string, string> = buildAllowlist();

async function resolveAllowed(repo: string, relPath: string): Promise<string> {
  const base = ALLOWLIST[repo];
  if (!base) {
    throw new Error(`Unknown repo "${repo}". Allowed repos: ${Object.keys(ALLOWLIST).join(', ')}`);
  }
  if (relPath.includes('..')) {
    throw new Error(`Path traversal rejected: relPath must not contain ".."`);
  }
  const joined = path.join(base, relPath);
  // Resolve symlinks to catch traversal via symlinks inside the repo.
  // For files that don't exist yet (e.g., new writes), resolve only what exists:
  // walk up from joined until we find an existing path, then resolve that.
  const realBase = await fs.realpath(base).catch(() => base);

  let realJoined: string;
  try {
    realJoined = await fs.realpath(joined);
  } catch {
    // File doesn't exist yet — resolve the nearest existing ancestor to normalise
    // symlinks in the directory path (e.g. /var → /private/var on macOS).
    const parent = path.dirname(joined);
    const realParent = await fs.realpath(parent).catch(() => parent);
    realJoined = path.join(realParent, path.basename(joined));
  }

  if (!realJoined.startsWith(realBase + path.sep) && realJoined !== realBase) {
    throw new Error(`Path traversal via symlink rejected`);
  }
  return joined;
}

export const crossRepoReadTool: Tool = {
  name: 'cross_repo_read',
  description: 'Read a file from an allowlisted sibling repository',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: `Repository key (allowed: ${Object.keys(ALLOWLIST).join(', ')})`,
      },
      relPath: {
        type: 'string',
        description: 'Relative path within the repository',
      },
    },
    required: ['repo', 'relPath'],
  },
  async execute(input: ToolInput): Promise<string> {
    const filePath = await resolveAllowed(input['repo'] as string, input['relPath'] as string);
    return fs.readFile(filePath, 'utf-8');
  },
};

export const crossRepoWriteTool: Tool = {
  name: 'cross_repo_write',
  description: 'Write a file to an allowlisted sibling repository',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: `Repository key (allowed: ${Object.keys(ALLOWLIST).join(', ')})`,
      },
      relPath: {
        type: 'string',
        description: 'Relative path within the repository',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
    },
    required: ['repo', 'relPath', 'content'],
  },
  async execute(input: ToolInput): Promise<string> {
    const filePath = await resolveAllowed(input['repo'] as string, input['relPath'] as string);
    const content = input['content'] as string;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return `Wrote ${content.length} bytes to ${filePath}`;
  },
};

export const crossRepoRunTestsTool: Tool = {
  name: 'cross_repo_run_tests',
  description: 'Run pytest in an allowlisted sibling repository and return output',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: `Repository key (allowed: ${Object.keys(ALLOWLIST).join(', ')})`,
      },
    },
    required: ['repo'],
  },
  async execute(input: ToolInput): Promise<string> {
    const base = ALLOWLIST[input['repo'] as string];
    if (!base) {
      throw new Error(
        `Unknown repo "${input['repo'] as string}". Allowed repos: ${Object.keys(ALLOWLIST).join(', ')}`,
      );
    }
    const result = await execa('python3', ['-m', 'pytest', '--tb=short'], {
      cwd: base,
      reject: false,
      all: true,
    });
    const output = result.all ?? result.stdout ?? '';
    const passed = result.exitCode === 0;
    return `${passed ? 'PASS' : 'FAIL'}\n\n${output}`;
  },
};

export const crossRepoTools: Tool[] = [
  crossRepoReadTool,
  crossRepoWriteTool,
  crossRepoRunTestsTool,
];
