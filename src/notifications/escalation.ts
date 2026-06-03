import { listTasks, logNotification, getLastNotificationFor } from '../db/index.js';
import { routeResponse } from '../channels/router.js';
import { loadRules, loadEscalationSettings } from './store.js';
import type { EscalationLevel } from '../db/schema.js';

const HOUR_MS = 60 * 60 * 1000;
const TICK_INTERVAL_MS = 15 * 60 * 1000;

// Pure function — testable without DB or side effects.
export function computeLevel(deadline: string, nowMs: number): EscalationLevel | null {
  const deadlineMs = new Date(deadline).getTime();
  const diffHours = (deadlineMs - nowMs) / HOUR_MS;

  if (diffHours > 48) return null;
  if (diffHours > 24) return 'due-tomorrow';
  if (diffHours > 8)  return '24h';
  if (diffHours > 0)  return '8h';
  return 'overdue';
}

function shouldSend(taskId: string, level: EscalationLevel): boolean {
  const last = getLastNotificationFor(taskId, level);
  if (!last) return true;
  return Date.now() - new Date(last.sent_at).getTime() >= HOUR_MS;
}

const LEVEL_TITLES: Record<EscalationLevel, (title: string) => string> = {
  'due-tomorrow': (t) => `Due tomorrow: ${t}`,
  '24h':          (t) => `Due in <24h: ${t}`,
  '8h':           (t) => `Due in <8h: ${t}`,
  'overdue':      (t) => `Overdue: ${t}`,
};

export class EscalationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private configOverride: Partial<{ enabled: boolean }> = {};

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_INTERVAL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  updateConfig(c: Partial<{ enabled: boolean }>): void {
    this.configOverride = { ...this.configOverride, ...c };
  }

  async tick(): Promise<void> {
    const settings = loadEscalationSettings();
    const enabled = this.configOverride.enabled ?? settings.enabled;
    if (!enabled) return;

    const tasks = listTasks();
    const nowMs = Date.now();

    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'cancelled') continue;
      if (!task.deadline) continue;

      const level = computeLevel(task.deadline, nowMs);
      if (!level) continue;
      if (!shouldSend(task.id, level)) continue;

      const critical = level === '8h' || level === 'overdue';
      await routeResponse('escalation', LEVEL_TITLES[level](task.title), task.title, { critical });

      const rules = loadRules();
      const matched = rules.find(r => r.event === 'escalation' || r.event === '*');
      logNotification(task.id, level, matched?.channel ?? 'ntfy');
    }
  }
}

export const escalationScheduler = new EscalationScheduler();
