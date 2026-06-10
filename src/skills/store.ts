import fs from 'fs';
import os from 'os';
import path from 'path';

export interface CustomSkillDef {
  name: string;
  description: string;
  type: 'bash' | 'http' | 'mcp';
  config: Record<string, string>;
  createdAt: string;
}

function customSkillsPath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'custom-skills.json');
}

let _skillsCache: { value: CustomSkillDef[]; ts: number } | null = null;
const SKILLS_CACHE_TTL_MS = 5_000;

export function loadCustomSkills(): CustomSkillDef[] {
  const now = Date.now();
  if (_skillsCache && now - _skillsCache.ts < SKILLS_CACHE_TTL_MS) {
    return _skillsCache.value;
  }
  try {
    const raw = fs.readFileSync(customSkillsPath(), 'utf8');
    const value = JSON.parse(raw) as CustomSkillDef[];
    _skillsCache = { value, ts: now };
    return value;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export function saveCustomSkill(skill: CustomSkillDef): void {
  const all = loadCustomSkills();
  const idx = all.findIndex(s => s.name === skill.name);
  if (idx >= 0) {
    all[idx] = skill;
  } else {
    all.push(skill);
  }
  const p = customSkillsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Atomic write: write to tmp then rename to avoid partial reads
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
  fs.chmodSync(p, 0o600);
  _skillsCache = null;
}

export function deleteCustomSkill(name: string): void {
  const all = loadCustomSkills();
  const filtered = all.filter(s => s.name !== name);
  const p = customSkillsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Atomic write: write to tmp then rename to avoid partial reads
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(filtered, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, p);
  fs.chmodSync(p, 0o600);
  _skillsCache = null;
}
