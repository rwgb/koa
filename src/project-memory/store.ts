import fs from 'fs';
import path from 'path';
import { projectMemoryPaths } from './paths.js';

export function ensureProjectMemoryDir(projectPath: string): void {
  const { dir, journalDir } = projectMemoryPaths(projectPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(journalDir, { recursive: true, mode: 0o700 });
}

export function readMarkdownFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// Atomic write: tmp file + rename to prevent corrupt output on crash.
// The tmp name is per-process + timestamped so concurrent writers don't clobber
// each other's staging file before the rename.
export function writeMarkdownFile(filePath: string, content: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function appendJournalEntry(projectPath: string, content: string): void {
  const { journalDir } = projectMemoryPaths(projectPath);
  fs.mkdirSync(journalDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const journalFile = path.join(journalDir, `${today}.md`);
  const existing = readMarkdownFile(journalFile);
  const separator = existing ? '\n\n---\n\n' : '';
  writeMarkdownFile(journalFile, (existing ?? '') + separator + content);
}

export function readRecentJournals(projectPath: string, count = 3): string[] {
  const { journalDir } = projectMemoryPaths(projectPath);
  try {
    const files = fs
      .readdirSync(journalDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, count);
    return files
      .map((f) => readMarkdownFile(path.join(journalDir, f)))
      .filter((c): c is string => c !== null);
  } catch {
    return [];
  }
}

export interface HandoffData {
  agent: string;
  lastAgent: string;
  nextAgent: string;
  status: 'PASS' | 'FAIL' | 'RUNNING' | 'COMPLETE';
  plan: string;
  tasks?: string;
}

export function writeHandoff(projectPath: string, data: HandoffData): void {
  const { handoffMd } = projectMemoryPaths(projectPath);
  const tasksSection = data.tasks ? `\n### Tasks\n${data.tasks}` : '';
  const content = `# HANDOFF.md

## ${data.agent}
**Agent**: ${data.agent}
**Last agent**: ${data.lastAgent}
**Next agent**: ${data.nextAgent}
**Status**: ${data.status}

### Plan
${data.plan}
${tasksSection}
`;
  writeMarkdownFile(handoffMd, content);
}
