import fs from 'fs';
import path from 'path';
import os from 'os';

// KOA_HOME allows tests (and power users) to redirect the config dir.
function koaDir(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa');
}
function credentialsFile(): string {
  return path.join(koaDir(), 'credentials');
}

function parseCredentials(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function readCredentials(): Record<string, string> {
  try {
    return parseCredentials(fs.readFileSync(credentialsFile(), 'utf8'));
  } catch {
    return {};
  }
}

export function writeCredential(key: string, value: string): void {
  fs.mkdirSync(koaDir(), { recursive: true, mode: 0o700 });

  let existing: Record<string, string> = {};
  try {
    existing = parseCredentials(fs.readFileSync(credentialsFile(), 'utf8'));
  } catch {
    // file doesn't exist yet — start fresh
  }

  existing[key] = value;

  const content = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

  fs.writeFileSync(credentialsFile(), content, { mode: 0o600 });
}

export function deleteCredential(key: string): void {
  let existing: Record<string, string>;
  try {
    existing = parseCredentials(fs.readFileSync(credentialsFile(), 'utf8'));
  } catch {
    return;
  }

  delete existing[key];

  const content = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';

  fs.writeFileSync(credentialsFile(), content, { mode: 0o600 });
}

export function getCredentialsPath(): string {
  return credentialsFile();
}
