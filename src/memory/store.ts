import fs from 'fs';
import path from 'path';
import os from 'os';

function memoryFilePath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'memory.json');
}
const MAX_MEMORIES = 200;

export interface MemoryEntry {
  fact: string;
  timestamp: string;
}

interface MemoryFile {
  memories: MemoryEntry[];
}

function read(now = Date.now()): MemoryFile {
  const file = memoryFilePath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { memories: [] };
    throw err;
  }
  try {
    return JSON.parse(raw) as MemoryFile;
  } catch (err) {
    // The file exists but is unparseable. Do NOT silently discard it — preserve
    // the bytes for forensics and start fresh, logging loudly.
    const corruptPath = `${file}.corrupt-${now}`;
    try {
      fs.renameSync(file, corruptPath);
    } catch {
      /* best-effort; fall through to empty */
    }
    process.stderr.write(
      `[koa/memory] memory.json was corrupt (${(err as Error).message}); ` +
        `preserved at ${corruptPath}, starting with empty memory.\n`,
    );
    return { memories: [] };
  }
}

function write(file: MemoryFile): void {
  const target = memoryFilePath();
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write: tmp file + rename so a crash mid-write can't truncate the store.
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function loadMemories(): MemoryEntry[] {
  return read().memories;
}

export function addMemory(fact: string): void {
  const file = read();
  file.memories.push({ fact: fact.trim(), timestamp: new Date().toISOString() });
  if (file.memories.length > MAX_MEMORIES) {
    file.memories = file.memories.slice(-MAX_MEMORIES);
  }
  write(file);
}

export function removeMemory(fact: string): boolean {
  const file = read();
  const target = fact.trim().toLowerCase();
  const before = file.memories.length;
  // Require a whole-fact match (case-insensitive) so removing one memory
  // can't accidentally delete every memory that merely contains the substring.
  file.memories = file.memories.filter((m) => m.fact.trim().toLowerCase() !== target);
  if (file.memories.length < before) {
    write(file);
    return true;
  }
  return false;
}

export function buildMemoryPromptInjection(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `- ${m.fact}`).join('\n');
  return `<user_memories>\n${lines}\n</user_memories>`;
}
