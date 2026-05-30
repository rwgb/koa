import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SessionRecord } from '../types/index.js';

export type { SessionRecord };

const SESSIONS_DIR = path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'sessions');
const MAX_SESSIONS_PER_PROJECT = 5;
const MAX_MESSAGE_PREVIEW = 120;

interface SessionFile {
  sessions: SessionRecord[];
}

function slugify(projectPath: string): string {
  return projectPath
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sessionFilePath(projectPath: string): string {
  return path.join(SESSIONS_DIR, `${slugify(projectPath)}.json`);
}

export function loadLastSession(projectPath: string): SessionRecord | null {
  try {
    const raw = fs.readFileSync(sessionFilePath(projectPath), 'utf8');
    const file = JSON.parse(raw) as SessionFile;
    return file.sessions[file.sessions.length - 1] ?? null;
  } catch {
    return null;
  }
}

export function saveSession(record: SessionRecord): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });

  const filePath = sessionFilePath(record.projectPath);
  let existing: SessionFile = { sessions: [] };
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionFile;
  } catch {
    // first session for this project
  }

  existing.sessions.push(record);
  if (existing.sessions.length > MAX_SESSIONS_PER_PROJECT) {
    existing.sessions = existing.sessions.slice(-MAX_SESSIONS_PER_PROJECT);
  }

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), { mode: 0o600 });
}

export function buildSessionRecord(
  projectPath: string,
  turnCount: number,
  userMessages: string[],
): SessionRecord {
  const truncate = (s: string) =>
    s.length > MAX_MESSAGE_PREVIEW ? s.slice(0, MAX_MESSAGE_PREVIEW) + '…' : s;

  const firstMessage = truncate(userMessages[0] ?? '');
  // Last 3 user messages, excluding the first one
  const recentMessages = userMessages
    .slice(1)
    .slice(-3)
    .map(truncate);

  return {
    timestamp: new Date().toISOString(),
    turnCount,
    firstMessage,
    recentMessages,
    projectPath,
  };
}

export function buildSessionPromptInjection(last: SessionRecord): string {
  const date = new Date(last.timestamp).toLocaleString();
  const lines = [
    `<previous_session>`,
    `Date: ${date} | Turns: ${last.turnCount}`,
    `Started with: "${last.firstMessage}"`,
  ];

  if (last.recentMessages.length > 0) {
    lines.push(`Recent topics:`);
    for (const msg of last.recentMessages) {
      lines.push(`  - "${msg}"`);
    }
  }

  lines.push(`</previous_session>`);
  return lines.join('\n');
}
