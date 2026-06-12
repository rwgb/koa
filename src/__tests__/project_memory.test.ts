import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { projectMemoryDir, projectMemoryPaths } from '../project-memory/paths.js';
import {
  ensureProjectMemoryDir,
  readMarkdownFile,
  writeMarkdownFile,
  appendJournalEntry,
  readRecentJournals,
  writeHandoff,
} from '../project-memory/store.js';

let tmpDir: string;
const originalEnv = process.env;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-mem-test-'));
  process.env = { ...originalEnv, KOA_HOME: tmpDir };
});

afterEach(() => {
  process.env = originalEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// paths.ts
// ──────────────────────────────────────────────────────────────────────────────

describe('projectMemoryDir()', () => {
  it('includes the project basename as a slug', () => {
    const dir = projectMemoryDir('/some/path/myproject');
    expect(path.basename(dir)).toMatch(/^myproject-[0-9a-f]{8}$/);
  });

  it('is stable — same input always returns same directory', () => {
    const a = projectMemoryDir('/a/b/koa');
    const b = projectMemoryDir('/a/b/koa');
    expect(a).toBe(b);
  });

  it('produces different directories for different project paths', () => {
    const a = projectMemoryDir('/projects/alpha');
    const b = projectMemoryDir('/projects/beta');
    expect(a).not.toBe(b);
  });

  it('produces different directories for same name but different paths', () => {
    const a = projectMemoryDir('/workspace/koa');
    const b = projectMemoryDir('/other/koa');
    expect(a).not.toBe(b);
  });

  it('respects KOA_HOME env var override', () => {
    const custom = path.join(tmpDir, 'custom-home');
    process.env['KOA_HOME'] = custom;
    const result = projectMemoryDir('/projects/koa');
    expect(result.startsWith(custom)).toBe(true);
  });

  it('falls back to os.homedir() when KOA_HOME is unset', () => {
    delete process.env['KOA_HOME'];
    const result = projectMemoryDir('/projects/koa');
    expect(result.startsWith(os.homedir())).toBe(true);
  });
});

describe('projectMemoryPaths()', () => {
  it('all file paths are under the project dir', () => {
    const paths = projectMemoryPaths('/test/project');
    const { dir, projectMd, stateMd, backlogMd, handoffMd, journalDir } = paths;
    expect(projectMd.startsWith(dir)).toBe(true);
    expect(stateMd.startsWith(dir)).toBe(true);
    expect(backlogMd.startsWith(dir)).toBe(true);
    expect(handoffMd.startsWith(dir)).toBe(true);
    expect(journalDir.startsWith(dir)).toBe(true);
  });

  it('uses expected filenames', () => {
    const paths = projectMemoryPaths('/test/project');
    expect(path.basename(paths.projectMd)).toBe('PROJECT.md');
    expect(path.basename(paths.stateMd)).toBe('STATE.md');
    expect(path.basename(paths.backlogMd)).toBe('BACKLOG.md');
    expect(path.basename(paths.handoffMd)).toBe('HANDOFF.md');
    expect(path.basename(paths.journalDir)).toBe('journal');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// store.ts
// ──────────────────────────────────────────────────────────────────────────────

describe('ensureProjectMemoryDir()', () => {
  it('creates the project dir and journal subdir', () => {
    const projectPath = path.join(tmpDir, 'myproj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);

    const paths = projectMemoryPaths(projectPath);
    expect(fs.existsSync(paths.dir)).toBe(true);
    expect(fs.existsSync(paths.journalDir)).toBe(true);
  });

  it('is idempotent — calling twice does not throw', () => {
    const projectPath = path.join(tmpDir, 'myproj');
    fs.mkdirSync(projectPath);
    expect(() => {
      ensureProjectMemoryDir(projectPath);
      ensureProjectMemoryDir(projectPath);
    }).not.toThrow();
  });
});

describe('readMarkdownFile()', () => {
  it('returns null for a non-existent file', () => {
    expect(readMarkdownFile(path.join(tmpDir, 'ghost.md'))).toBeNull();
  });

  it('returns file content for an existing file', () => {
    const file = path.join(tmpDir, 'test.md');
    fs.writeFileSync(file, '# Hello\n');
    expect(readMarkdownFile(file)).toBe('# Hello\n');
  });
});

describe('writeMarkdownFile()', () => {
  it('writes content to the target file', () => {
    const file = path.join(tmpDir, 'out.md');
    writeMarkdownFile(file, '# State\n\nsome content');
    expect(fs.readFileSync(file, 'utf8')).toBe('# State\n\nsome content');
  });

  it('leaves no .tmp file after successful write', () => {
    const file = path.join(tmpDir, 'out.md');
    writeMarkdownFile(file, 'content');
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('overwrites existing file', () => {
    const file = path.join(tmpDir, 'out.md');
    writeMarkdownFile(file, 'first');
    writeMarkdownFile(file, 'second');
    expect(fs.readFileSync(file, 'utf8')).toBe('second');
  });

  it('20 concurrent writers: final content is one complete payload and no .tmp files remain', async () => {
    const file = path.join(tmpDir, 'concurrent.md');
    const payload = 'concurrent-payload-content';

    await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(writeMarkdownFile(file, payload))),
    );

    expect(fs.readFileSync(file, 'utf8')).toBe(payload);

    const leftover = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp'));
    expect(leftover).toHaveLength(0);
  });
});

describe('appendJournalEntry()', () => {
  it('creates the journal file with content on first call', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);

    appendJournalEntry(projectPath, '### Accomplished\n- thing done');

    const { journalDir } = projectMemoryPaths(projectPath);
    const files = fs.readdirSync(journalDir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(journalDir, files[0]!), 'utf8');
    expect(content).toContain('### Accomplished');
  });

  it('appends with separator on second call to same day file', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);

    appendJournalEntry(projectPath, 'Entry A');
    appendJournalEntry(projectPath, 'Entry B');

    const { journalDir } = projectMemoryPaths(projectPath);
    const files = fs.readdirSync(journalDir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(journalDir, files[0]!), 'utf8');
    expect(content).toContain('Entry A');
    expect(content).toContain('Entry B');
    expect(content).toContain('---');
  });
});

describe('readRecentJournals()', () => {
  it('returns empty array when journal dir does not exist', () => {
    const projectPath = path.join(tmpDir, 'no-journals');
    expect(readRecentJournals(projectPath, 3)).toEqual([]);
  });

  it('returns journal entries sorted newest-first', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);
    const { journalDir } = projectMemoryPaths(projectPath);

    fs.writeFileSync(path.join(journalDir, '2026-05-01.md'), 'oldest');
    fs.writeFileSync(path.join(journalDir, '2026-05-10.md'), 'middle');
    fs.writeFileSync(path.join(journalDir, '2026-05-20.md'), 'newest');

    const journals = readRecentJournals(projectPath, 3);
    expect(journals).toHaveLength(3);
    expect(journals[0]).toBe('newest');
    expect(journals[1]).toBe('middle');
    expect(journals[2]).toBe('oldest');
  });

  it('respects the count parameter', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);
    const { journalDir } = projectMemoryPaths(projectPath);

    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(journalDir, `2026-05-${String(i).padStart(2, '0')}.md`), `entry ${i}`);
    }

    const journals = readRecentJournals(projectPath, 2);
    expect(journals).toHaveLength(2);
    expect(journals[0]).toBe('entry 5');
    expect(journals[1]).toBe('entry 4');
  });
});

describe('writeHandoff()', () => {
  it('writes a HANDOFF.md with the correct structure', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);

    writeHandoff(projectPath, {
      agent: 'architect',
      lastAgent: 'koa',
      nextAgent: 'coder',
      status: 'PASS',
      plan: 'Build the feature layer',
    });

    const { handoffMd } = projectMemoryPaths(projectPath);
    const content = fs.readFileSync(handoffMd, 'utf8');
    expect(content).toContain('# HANDOFF.md');
    expect(content).toContain('**Agent**: architect');
    expect(content).toContain('**Last agent**: koa');
    expect(content).toContain('**Next agent**: coder');
    expect(content).toContain('**Status**: PASS');
    expect(content).toContain('Build the feature layer');
  });

  it('includes tasks section when tasks field is provided', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);

    writeHandoff(projectPath, {
      agent: 'coder',
      lastAgent: 'architect',
      nextAgent: 'reviewer',
      status: 'RUNNING',
      plan: 'Implement memory module',
      tasks: '- [ ] Write store.ts\n- [ ] Write paths.ts',
    });

    const { handoffMd } = projectMemoryPaths(projectPath);
    const content = fs.readFileSync(handoffMd, 'utf8');
    expect(content).toContain('### Tasks');
    expect(content).toContain('Write store.ts');
  });

  it('omits tasks section when tasks field is not provided', () => {
    const projectPath = path.join(tmpDir, 'proj');
    fs.mkdirSync(projectPath);
    ensureProjectMemoryDir(projectPath);

    writeHandoff(projectPath, {
      agent: 'reviewer',
      lastAgent: 'coder',
      nextAgent: 'koa',
      status: 'PASS',
      plan: 'All clear',
    });

    const { handoffMd } = projectMemoryPaths(projectPath);
    const content = fs.readFileSync(handoffMd, 'utf8');
    expect(content).not.toContain('### Tasks');
  });
});
