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

export interface EscalationSettings {
  enabled: boolean;
}

interface NotificationsData {
  rules: NotificationRule[];
  quietHours: QuietHours;
  escalation: EscalationSettings;
}

const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, from: '22:00', to: '08:00' };
const DEFAULT_ESCALATION: EscalationSettings = { enabled: true };

function notificationsPath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'notifications.json');
}

function loadData(): NotificationsData {
  try {
    const raw = fs.readFileSync(notificationsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<NotificationsData>;
    return {
      rules: parsed.rules ?? [],
      quietHours: parsed.quietHours ?? DEFAULT_QUIET_HOURS,
      escalation: parsed.escalation ?? DEFAULT_ESCALATION,
    };
  } catch {
    return { rules: [], quietHours: DEFAULT_QUIET_HOURS, escalation: DEFAULT_ESCALATION };
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

export function loadEscalationSettings(): EscalationSettings {
  return loadData().escalation;
}

export function saveEscalationSettings(s: EscalationSettings): void {
  const data = loadData();
  data.escalation = s;
  saveData(data);
}
