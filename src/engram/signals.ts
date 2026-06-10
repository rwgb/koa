import fs from 'fs';
import path from 'path';
import os from 'os';

export type SignalType = 'thin-context' | 'empty-query' | 'failed-call' | 'slow-sync' | 'poor-recall';

export interface EngramSignal {
  ts: string;
  type: SignalType;
  detail: string;
}

function signalsPath(): string {
  const base = process.env['KOA_HOME'] ?? os.homedir();
  return path.join(base, '.koa', 'signals', 'engram.jsonl');
}

export function emitSignal(type: SignalType, detail: string): void {
  const signal: EngramSignal = { ts: new Date().toISOString(), type, detail };
  const line = JSON.stringify(signal) + '\n';
  try {
    const filePath = signalsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line, { encoding: 'utf8' });
  } catch {
    // non-fatal — signal emission must never crash the caller
  }
}

export function readRecentSignals(n: number): EngramSignal[] {
  try {
    const filePath = signalsPath();
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    return lines
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l) as EngramSignal;
        } catch {
          return null;
        }
      })
      .filter((s): s is EngramSignal => s !== null);
  } catch {
    return [];
  }
}
