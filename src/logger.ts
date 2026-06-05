import fs from 'fs';
import path from 'path';
import os from 'os';

function logDir(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'logs');
}

let _stream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream {
  if (!_stream) {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(dir, `koa-${date}.log`);
    _stream = fs.createWriteStream(logFile, { flags: 'a', mode: 0o600 });
  }
  return _stream;
}

export function log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data });
  getStream().write(entry + '\n');
}

export function closeLogger(): void {
  _stream?.end();
  _stream = null;
}
