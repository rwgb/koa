import type { TurnScheduler } from '../agent/scheduler.js';
import { listDelegations, updateDelegation } from '../db/index.js';

function msUntilDue(schedule: string, _lastRun: Date): number {
  const DAY = 86_400_000;
  const s = schedule.toLowerCase().trim();
  if (s === 'daily') return DAY;
  if (s === 'weekly') return 7 * DAY;
  if (s === 'monthly') return 30 * DAY;
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  if (days.includes(s)) return 7 * DAY;
  // Try to parse as hours: "every 6h", "6h"
  const hoursMatch = s.match(/^(?:every\s+)?(\d+)h$/);
  if (hoursMatch) return parseInt(hoursMatch[1]!, 10) * 3_600_000;
  return DAY; // default daily
}

export function isDue(
  delegation: { schedule: string; last_run: string | null; enabled: number },
  now = new Date(),
): boolean {
  if (!delegation.enabled) return false;
  if (!delegation.last_run) return true;
  const lastRun = new Date(delegation.last_run);
  return now.getTime() - lastRun.getTime() >= msUntilDue(delegation.schedule, lastRun);
}

export async function runDueDelegations(scheduler: TurnScheduler): Promise<void> {
  const now = new Date();
  const delegations = listDelegations().filter(d => d.enabled === 1);
  for (const d of delegations) {
    if (isDue(d, now)) {
      try {
        // Low priority so user-initiated turns always preempt delegations in the queue
        await scheduler.enqueue(d.action, 'low');
        updateDelegation(d.id, { last_run: now.toISOString() });
      } catch (err) {
        process.stderr.write(`[koa/delegations] error running delegation ${d.id}: ${err}\n`);
      }
    }
  }
}
