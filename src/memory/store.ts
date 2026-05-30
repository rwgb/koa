import fs from 'fs';
import path from 'path';
import os from 'os';

const MEMORY_FILE = path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'memory.json');
const MAX_MEMORIES = 200;

export interface MemoryEntry {
  fact: string;
  timestamp: string;
}

interface MemoryFile {
  memories: MemoryEntry[];
}

function read(): MemoryFile {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) as MemoryFile;
  } catch {
    return { memories: [] };
  }
}

function write(file: MemoryFile): void {
  const dir = path.dirname(MEMORY_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(file, null, 2), { mode: 0o600 });
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
  const lower = fact.toLowerCase();
  const before = file.memories.length;
  file.memories = file.memories.filter(
    (m) => !m.fact.toLowerCase().includes(lower),
  );
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
