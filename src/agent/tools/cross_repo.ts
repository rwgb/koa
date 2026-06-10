import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import type { Tool, ToolInput } from '../../types/index.js';

const ALLOWLIST: Record<string, string> = {
  engram: path.join(os.homedir(), 'active projects/engram'),
};

async function resolveAllowed(repo: string, relPath: string): Promise<string> {
  const base = ALLOWLIST[repo];
  if (!base) {
    throw new Error(`Unknown repo "${repo}". Allowed repos: ${Object.keys(ALLOWLIST).join(', ')}`);
  }
  if (relPath.includes('..')) {
    throw new Error(`Path traversal rejected: relPath must not contain ".."`);
  }
  const joined = path.join(base, relPath);
  // Resolve symlinks to catch traversal via symlinks inside the repo
  const [realJoined, realBase] = await Promise.all([
    fs.realpath(joined).catch(() => joined),
    fs.realpath(base).catch(() => base),
  ]);
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
