import { getBlockedTasksSince, getUpcomingTasks, listTasks } from '../db/index.js';
import type { Task } from '../db/index.js';

export interface ProactiveAlert {
  type: 'blocked' | 'end-of-week' | 'overdue' | 'stalled';
  message: string;
  tasks: Task[];
}

/** Tasks blocked for >= minDays (default 3). */
export function detectBlockedTasks(minDays = 3): ProactiveAlert | null {
  const tasks = getBlockedTasksSince(minDays);
  if (tasks.length === 0) return null;

  const noun = tasks.length === 1 ? 'task has' : 'tasks have';
  return {
    type: 'blocked',
    message: `${tasks.length} ${noun} been blocked for ${minDays}+ days and may need intervention.`,
    tasks,
  };
}

/** High-priority open tasks with deadlines this week, surfaced only Thu–Fri. */
export function detectEndOfWeekAlerts(): ProactiveAlert | null {
  const day = new Date().getDay(); // 0=Sun…6=Sat
  if (day !== 4 && day !== 5) return null; // only Thu (4) or Fri (5)

  const tasks = getUpcomingTasks(3).filter((t) => t.priority <= 2);
  if (tasks.length === 0) return null;

  return {
    type: 'end-of-week',
    message: `${tasks.length} high-priority task${tasks.length !== 1 ? 's' : ''} due before week end — Friday check-in.`,
    tasks,
  };
}

/** Tasks that have been in_progress for more than stalledDays without update. */
export function detectStalledTasks(stalledDays = 5): ProactiveAlert | null {
  const cutoff = new Date(Date.now() - stalledDays * 86_400_000).toISOString();
  const tasks = listTasks({ status: 'in_progress' }).filter((t) => t.updated_at <= cutoff);
  if (tasks.length === 0) return null;

  const noun = tasks.length === 1 ? 'task is' : 'tasks are';
  return {
    type: 'stalled',
    message: `${tasks.length} in-progress ${noun} stalled (no update for ${stalledDays}+ days).`,
    tasks,
  };
}

/** Tasks with a past deadline that aren't done or cancelled. */
export function detectOverdueTasks(): ProactiveAlert | null {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = listTasks()
    .filter((t) => t.deadline && t.deadline < today && !['done', 'cancelled'].includes(t.status));
  if (tasks.length === 0) return null;

  return {
    type: 'overdue',
    message: `${tasks.length} task${tasks.length !== 1 ? 's' : ''} overdue — deadline has passed.`,
    tasks,
  };
}

export function buildProactiveAlerts(): ProactiveAlert[] {
  const candidates = [
    detectBlockedTasks(),
    detectStalledTasks(),
    detectOverdueTasks(),
    detectEndOfWeekAlerts(),
  ];
  return candidates.filter((a): a is ProactiveAlert => a !== null);
}

export function buildProactiveAlertsText(alerts: ProactiveAlert[]): string {
  if (alerts.length === 0) return '';

  const lines = ['## Proactive Alerts'];
  for (const alert of alerts) {
    lines.push(`- ${alert.message}`);
    for (const t of alert.tasks.slice(0, 3)) {
      lines.push(`  - ${t.title} (${t.status}${t.deadline ? `, due ${t.deadline}` : ''})`);
    }
    if (alert.tasks.length > 3) {
      lines.push(`  - … and ${alert.tasks.length - 3} more`);
    }
  }
  return lines.join('\n');
}
