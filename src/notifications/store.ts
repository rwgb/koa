import fs from 'fs';
import os from 'os';
import path from 'path';

export interface NotificationRule {
  id: string;
  event: string;
  channel: string;
  condition?: string;
  template?: string;
}

export interface QuietHours {
  enabled: boolean;
  from: string; // HH:MM 24h
  to: string;   // HH:MM 24h
}

interface NotificationsData {
  rules: NotificationRule[];
  quietHours: QuietHours;
}

const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, from: '22:00', to: '08:00' };

function notificationsPath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'notifications.json');
}

function loadData(): NotificationsData {
  try {
    const raw = fs.readFileSync(notificationsPath(), 'utf8');
    return JSON.parse(raw) as NotificationsData;
  } catch {
    return { rules: [], quietHours: DEFAULT_QUIET_HOURS };
  }
}

function saveData(data: NotificationsData): void {
  const p = notificationsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function loadRules(): NotificationRule[] {
  return loadData().rules;
}

export function saveRules(rules: NotificationRule[]): void {
  const data = loadData();
  data.rules = rules;
  saveData(data);
}

export function loadQuietHours(): QuietHours {
  return loadData().quietHours;
}

export function saveQuietHours(qh: QuietHours): void {
  const data = loadData();
  data.quietHours = qh;
  saveData(data);
}
