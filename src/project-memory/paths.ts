import path from 'path';
import os from 'os';
import { createHash } from 'crypto';

export function projectMemoryDir(projectPath: string): string {
  const slug = path.basename(projectPath);
  // Hash without lowercasing to preserve case-sensitive filesystem correctness
  const hash = createHash('md5').update(projectPath).digest('hex').slice(0, 8);
  const base = process.env['KOA_HOME'] ?? os.homedir();
  return path.join(base, '.koa', 'projects', `${slug}-${hash}`);
}

export interface ProjectMemoryPaths {
  dir: string;
  projectMd: string;
  stateMd: string;
  backlogMd: string;
  handoffMd: string;
  journalDir: string;
}

export function projectMemoryPaths(projectPath: string): ProjectMemoryPaths {
  const dir = projectMemoryDir(projectPath);
  return {
    dir,
    projectMd: path.join(dir, 'PROJECT.md'),
    stateMd: path.join(dir, 'STATE.md'),
    backlogMd: path.join(dir, 'BACKLOG.md'),
    handoffMd: path.join(dir, 'HANDOFF.md'),
    journalDir: path.join(dir, 'journal'),
  };
}
