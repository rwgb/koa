import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpiderBrainClient } from '../spiderbrain/client.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function makeFakeGraph(overrides: object = {}) {
  return JSON.stringify({
    prey: 'Ship the Koa agent CLI',
    nodes: {
      'src/agent/loop.ts': {
        webscore: 9.5,
        cluster: 'agent',
        role: 'orchestrator',
        dependedOnBy: ['src/cli/index.ts', 'src/server/index.ts'],
        lastChangedAt: '2026-05-28T10:00:00Z',
      },
      'src/config/index.ts': {
        webscore: 8.0,
        cluster: 'config',
        dependedOnBy: ['src/cli/index.ts'],
        lastChangedAt: '2026-05-27T09:00:00Z',
      },
      'src/agent/tools/bash.ts': {
        webscore: 7.5,
        cluster: 'tools',
        dependedOnBy: ['src/cli/index.ts'],
        lastChangedAt: '2026-05-29T12:00:00Z',
      },
      'src/types/index.ts': {
        webscore: 7.2,
        cluster: 'types',
        dependedOnBy: ['src/agent/loop.ts', 'src/config/index.ts', 'src/agent/tools/bash.ts'],
        lastChangedAt: '2026-05-26T08:00:00Z',
      },
      'src/engram/client.ts': {
        webscore: 8.8,
        cluster: 'engram',
        dependedOnBy: ['src/cli/index.ts'],
        lastChangedAt: '2026-05-25T07:00:00Z',
      },
      'src/server/index.ts': {
        webscore: 7.1,
        cluster: 'server',
        dependedOnBy: [],
        lastChangedAt: '2026-05-30T14:00:00Z',
      },
      'src/tui/App.tsx': {
        webscore: 6.5,
        cluster: 'tui',
        dependedOnBy: ['src/cli/index.ts'],
        lastChangedAt: '2026-05-24T06:00:00Z',
      },
      'src/agent/router.ts': {
        webscore: 7.8,
        cluster: 'agent',
        dependedOnBy: ['src/agent/loop.ts'],
        lastChangedAt: '2026-05-23T05:00:00Z',
      },
      'src/agent/usage.ts': {
        webscore: 6.0,
        cluster: 'agent',
        dependedOnBy: ['src/cli/index.ts'],
        lastChangedAt: '2026-05-22T04:00:00Z',
      },
      'src/cli/index.ts': {
        webscore: 5.0,
        cluster: 'cli',
        dependedOnBy: [],
        lastChangedAt: '2026-05-21T03:00:00Z',
      },
    },
    clusters: {
      agent: { webscore: 9.0, nodeCount: 3, topNodes: ['src/agent/loop.ts'] },
      engram: { webscore: 8.5, nodeCount: 1, topNodes: ['src/engram/client.ts'] },
      config: { webscore: 7.0, nodeCount: 1, topNodes: ['src/config/index.ts'] },
      tools: { webscore: 6.5, nodeCount: 1, topNodes: ['src/agent/tools/bash.ts'] },
      server: { webscore: 6.0, nodeCount: 1, topNodes: ['src/server/index.ts'] },
      types: { webscore: 5.5, nodeCount: 1, topNodes: ['src/types/index.ts'] },
      tui: { webscore: 4.0, nodeCount: 1, topNodes: ['src/tui/App.tsx'] },
      cli: { webscore: 3.0, nodeCount: 1, topNodes: ['src/cli/index.ts'] },
    },
    ...overrides,
  });
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-sb-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SpiderBrainClient.isAvailable()', () => {
  it('returns false when no synganglion.json exists as a sibling', () => {
    // projectPath has no <name>-spiderbrain sibling in tmpDir
    const projectPath = path.join(tmpDir, 'myproject');
    fs.mkdirSync(projectPath);
    const sb = new SpiderBrainClient(projectPath);
    expect(sb.isAvailable()).toBe(false);
  });

  it('returns true when an explicit brainDir is provided and synganglion.json exists', () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    expect(sb.isAvailable()).toBe(true);
  });
});

describe('SpiderBrainClient.getContext()', () => {
  it('returns available: false when not available', async () => {
    const sb = new SpiderBrainClient(path.join(tmpDir, 'nope'));
    const ctx = await sb.getContext();
    expect(ctx.available).toBe(false);
    expect(ctx.prey).toBe('');
    expect(ctx.masters).toHaveLength(0);
    expect(ctx.hotFiles).toHaveLength(0);
    expect(ctx.clusterNames).toHaveLength(0);
  });

  it('extracts top 8 masters by webscore from a fake graph', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();

    expect(ctx.available).toBe(true);
    expect(ctx.prey).toBe('Ship the Koa agent CLI');
    // Only nodes with webscore >= 7.0 qualify; we have 7 such nodes (scores: 9.5, 8.8, 8.0, 7.8, 7.5, 7.2, 7.1)
    expect(ctx.masters.length).toBeLessThanOrEqual(8);
    expect(ctx.masters.length).toBe(7);
    // Sorted descending by webscore
    expect(ctx.masters[0]!.webscore).toBe(9.5);
    expect(ctx.masters[0]!.id).toBe('src/agent/loop.ts');
    expect(ctx.masters[0]!.role).toBe('orchestrator');
    expect(ctx.masters[0]!.fanIn).toBe(2);
    // All masters have webscore >= 7.0
    for (const m of ctx.masters) {
      expect(m.webscore).toBeGreaterThanOrEqual(7.0);
    }
  });

  it('sorts hotFiles by lastChangedAt descending', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();

    expect(ctx.hotFiles).toHaveLength(8);
    // Most recent first: 2026-05-30 (src/server/index.ts)
    expect(ctx.hotFiles[0]).toBe('src/server/index.ts');
    // Second: 2026-05-29 (src/agent/tools/bash.ts)
    expect(ctx.hotFiles[1]).toBe('src/agent/tools/bash.ts');
  });

  it('returns cluster names sorted by cluster webscore descending', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();

    // agent(9.0) > engram(8.5) > config(7.0) > tools(6.5) > server(6.0) > types(5.5) > tui(4.0) > cli(3.0)
    expect(ctx.clusterNames[0]).toBe('agent');
    expect(ctx.clusterNames[1]).toBe('engram');
    expect(ctx.clusterNames[ctx.clusterNames.length - 1]).toBe('cli');
  });
});

describe('SpiderBrainClient.buildSystemPromptInjection()', () => {
  it('returns empty string when not available', () => {
    const sb = new SpiderBrainClient(tmpDir);
    const result = sb.buildSystemPromptInjection({
      available: false,
      prey: '',
      masters: [],
      hotFiles: [],
      clusterNames: [],
    });
    expect(result).toBe('');
  });

  it('returns XML block containing prey and masters when available', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();
    const result = sb.buildSystemPromptInjection(ctx);

    expect(result).toMatch(/^<spiderbrain_context>/);
    expect(result).toMatch(/<\/spiderbrain_context>$/);
    expect(result).toContain('Ship the Koa agent CLI');
    expect(result).toContain('src/agent/loop.ts');
    expect(result).toContain('webscore="9.5"');
  });
});

describe('SpiderBrainClient.cascade() input validation', () => {
  let sb: SpiderBrainClient;

  beforeEach(() => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    sb = new SpiderBrainClient(tmpDir, brainDir);
  });

  const badIds = [
    'src/foo.ts; rm -rf /',
    'src/foo.ts && echo bad',
    'src/foo.ts | cat /etc/passwd',
    'src/foo.ts$VAR',
    '`whoami`',
    'src/../../../etc/passwd',
    'src/foo.ts <input',
    'src/foo.ts >output',
  ];

  for (const id of badIds) {
    it(`rejects node ID: ${JSON.stringify(id)}`, async () => {
      await expect(sb.cascade(id)).rejects.toThrow(/Invalid node ID/);
    });
  }

  it('does not throw Invalid node ID for a clean node ID (may fail on script-not-found, not validation)', async () => {
    // A valid node ID like "src/agent/loop.ts" must pass validation; the error (if any) is
    // about the missing script, not about the input — so it must NOT throw /Invalid node ID/.
    try {
      await sb.cascade('src/agent/loop.ts');
    } catch (err: unknown) {
      expect(err).not.toMatchObject({ message: expect.stringMatching(/Invalid node ID/) });
    }
  });
});

describe('SpiderBrainClient edge cases', () => {
  it('getContext() returns empty masters when all nodes have webscore < 7', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(
      path.join(brainDir, 'synganglion.json'),
      JSON.stringify({
        prey: 'Low-score project',
        nodes: {
          'src/a.ts': { webscore: 6.9, cluster: 'core', dependedOnBy: [], lastChangedAt: '2026-05-01T00:00:00Z' },
          'src/b.ts': { webscore: 3.0, cluster: 'util', dependedOnBy: [], lastChangedAt: '2026-05-02T00:00:00Z' },
        },
        clusters: {
          core: { webscore: 6.9, nodeCount: 1, topNodes: ['src/a.ts'] },
          util: { webscore: 3.0, nodeCount: 1, topNodes: ['src/b.ts'] },
        },
      }),
    );
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();
    expect(ctx.available).toBe(true);
    expect(ctx.masters).toHaveLength(0);
    expect(ctx.hotFiles).toHaveLength(2); // both nodes have lastChangedAt
  });

  it('getContext() returns empty hotFiles when no node has lastChangedAt', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(
      path.join(brainDir, 'synganglion.json'),
      JSON.stringify({
        prey: 'No timestamps',
        nodes: {
          'src/x.ts': { webscore: 8.0, cluster: 'core', dependedOnBy: [] },
        },
        clusters: {
          core: { webscore: 8.0, nodeCount: 1, topNodes: ['src/x.ts'] },
        },
      }),
    );
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();
    expect(ctx.available).toBe(true);
    expect(ctx.hotFiles).toHaveLength(0);
    expect(ctx.masters).toHaveLength(1);
    expect(ctx.masters[0]!.id).toBe('src/x.ts');
  });

  it('getContext() handles an empty graph (no nodes, no clusters)', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(
      path.join(brainDir, 'synganglion.json'),
      JSON.stringify({ prey: 'Empty project', nodes: {}, clusters: {} }),
    );
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();
    expect(ctx.available).toBe(true);
    expect(ctx.prey).toBe('Empty project');
    expect(ctx.masters).toHaveLength(0);
    expect(ctx.hotFiles).toHaveLength(0);
    expect(ctx.clusterNames).toHaveLength(0);
  });

  it('buildSystemPromptInjection() includes hot_files XML block when hotFiles are present', async () => {
    const brainDir = path.join(tmpDir, 'brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    const ctx = await sb.getContext();
    const result = sb.buildSystemPromptInjection(ctx);
    expect(result).toContain('<hot_files>');
    expect(result).toContain('</hot_files>');
    expect(result).toContain('<file>src/server/index.ts</file>');
  });
});

describe('SpiderBrainClient.isStale()', () => {
  it('returns true when brainDir is null and no targetDir given', () => {
    const sb = new SpiderBrainClient(path.join(tmpDir, 'no-brain'));
    expect(sb.isStale()).toBe(true);
  });

  it('returns true when synganglion.json does not exist in targetDir', () => {
    const brainDir = path.join(tmpDir, 'empty-brain');
    fs.mkdirSync(brainDir);
    const sb = new SpiderBrainClient(tmpDir, brainDir);
    // Point at a dir with no synganglion.json
    expect(sb.isStale(path.join(tmpDir, 'nonexistent'))).toBe(true);
  });

  it('returns true when synganglion.json is older than 7 days', () => {
    const brainDir = path.join(tmpDir, 'old-brain');
    fs.mkdirSync(brainDir);
    const graphFile = path.join(brainDir, 'synganglion.json');
    fs.writeFileSync(graphFile, makeFakeGraph());
    // Set mtime to 8 days ago
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(graphFile, eightDaysAgo, eightDaysAgo);

    const sb = new SpiderBrainClient(tmpDir, brainDir);
    expect(sb.isStale()).toBe(true);
  });

  it('returns false when synganglion.json was just written', () => {
    const brainDir = path.join(tmpDir, 'fresh-brain');
    fs.mkdirSync(brainDir);
    fs.writeFileSync(path.join(brainDir, 'synganglion.json'), makeFakeGraph());

    const sb = new SpiderBrainClient(tmpDir, brainDir);
    expect(sb.isStale()).toBe(false);
  });
});
