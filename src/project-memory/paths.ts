import path from 'path';
import os from 'os';
import { createHash } from 'crypto';

/**
 * Returns the directory that holds project-scoped memory files.
 *
 * @param projectPath  Absolute path to the project being served.
 * @param homeOverride When provided, project memories are stored under
 *   <homeOverride>/projects/ instead of the default ~/.koa/projects/.
 *   Pass config.localHome here when running in `koa code` local mode so
 *   that local sessions never share storage with the remote server.
 */
export function projectMemoryDir(projectPath: string, homeOverride?: string): string {
  const slug = path.basename(projectPath);
  // Hash without lowercasing to preserve case-sensitive filesystem correctness
  const hash = createHash('md5').update(projectPath).digest('hex').slice(0, 8);
  if (homeOverride) {
    return path.join(homeOverride, 'projects', `${slug}-${hash}`);
  }
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

export function projectMemoryPaths(projectPath: string, homeOverride?: string): ProjectMemoryPaths {
  const dir = projectMemoryDir(projectPath, homeOverride);
  return {
    dir,
    projectMd: path.join(dir, 'PROJECT.md'),
    stateMd: path.join(dir, 'STATE.md'),
    backlogMd: path.join(dir, 'BACKLOG.md'),
    handoffMd: path.join(dir, 'HANDOFF.md'),
    journalDir: path.join(dir, 'journal'),
  };
}
