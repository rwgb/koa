import { listCalendarEvents } from '../db/index.js';
import type { Task } from '../db/schema.js';
import type { CalendarBlock, ConflictResult } from './types.js';

// A "busy" day has >= 4 hours of calendar events during work hours (9am-7pm).
const BUSY_DAY_THRESHOLD_HOURS = 4;
// Work hours for availability: 9am-6pm
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;
// Minimum block size to count as "available"
const MIN_BLOCK_HOURS = 1;

function overlapHours(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, (end - start) / 3_600_000);
}

export function getConflicts(task: Pick<Task, 'deadline' | 'effort_hours'>): ConflictResult {
  if (!task.deadline) return { hasConflict: false };

  const deadlineDate = new Date(task.deadline);
  if (isNaN(deadlineDate.getTime())) return { hasConflict: false };

  // Check the 3 days leading up to (and including) the deadline
  const windowStart = new Date(deadlineDate.getTime() - 3 * 86_400_000);
  const windowEnd = new Date(deadlineDate.getTime() + 86_400_000);

  const events = listCalendarEvents(windowStart.toISOString(), windowEnd.toISOString());

  const deadlineDayStart = new Date(task.deadline);
  deadlineDayStart.setHours(0, 0, 0, 0);
  const deadlineDayEnd = new Date(deadlineDayStart.getTime() + 86_400_000);

  const workStart = new Date(deadlineDayStart);
  workStart.setHours(WORK_START_HOUR, 0, 0, 0);
  const workEnd = new Date(deadlineDayStart);
  workEnd.setHours(WORK_END_HOUR, 0, 0, 0);

  let busyHoursOnDeadlineDay = 0;
  const conflictingEvents: Array<{ title: string; start: string; end: string }> = [];

  for (const event of events) {
    if (event.all_day) continue;
    const evStart = new Date(event.start_at);
    const evEnd = new Date(event.end_at);
    const overlap = overlapHours(evStart, evEnd, workStart, workEnd);
    if (overlap > 0) {
      busyHoursOnDeadlineDay += overlap;
      conflictingEvents.push({ title: event.title, start: event.start_at, end: event.end_at });
    }
  }

  const effortNeeded = task.effort_hours ?? 0;
  const freeHours = Math.max(0, (WORK_END_HOUR - WORK_START_HOUR) - busyHoursOnDeadlineDay);

  if (busyHoursOnDeadlineDay >= BUSY_DAY_THRESHOLD_HOURS && effortNeeded > freeHours) {
    return {
      hasConflict: true,
      reason: `Deadline day has ${busyHoursOnDeadlineDay.toFixed(1)}h of meetings; only ~${freeHours.toFixed(1)}h free but task needs ${effortNeeded}h.`,
      busyHoursOnDeadlineDay,
      events: conflictingEvents.slice(0, 5),
    };
  }

  return {
    hasConflict: false,
    busyHoursOnDeadlineDay,
    events: conflictingEvents.slice(0, 5),
  };
}

export function getAvailableBlocks(startIso: string, endIso: string): CalendarBlock[] {
  const rangeStart = new Date(startIso);
  const rangeEnd = new Date(endIso);
  const events = listCalendarEvents(startIso, endIso);
  const blocks: CalendarBlock[] = [];

  // Start cursor at local midnight of the start date to avoid UTC/local drift
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());

  while (cursor < rangeEnd) {
    const dayStart = new Date(cursor);
    dayStart.setHours(WORK_START_HOUR, 0, 0, 0);
    const dayEnd = new Date(cursor);
    dayEnd.setHours(WORK_END_HOUR, 0, 0, 0);

    // Collect sorted busy intervals within this work day
    const busyIntervals: Array<{ s: number; e: number }> = [];
    for (const event of events) {
      if (event.all_day) continue;
      const es = new Date(event.start_at).getTime();
      const ee = new Date(event.end_at).getTime();
      const ds = dayStart.getTime();
      const de = dayEnd.getTime();
      if (es < de && ee > ds) {
        busyIntervals.push({ s: Math.max(es, ds), e: Math.min(ee, de) });
      }
    }
    busyIntervals.sort((a, b) => a.s - b.s);

    // Find free gaps between busy intervals
    let freeStart = dayStart.getTime();
    for (const { s, e } of busyIntervals) {
      if (s > freeStart) {
        const durationHours = (s - freeStart) / 3_600_000;
        if (durationHours >= MIN_BLOCK_HOURS) {
          blocks.push({
            start: new Date(freeStart).toISOString(),
            end: new Date(s).toISOString(),
            durationHours,
          });
        }
      }
      freeStart = Math.max(freeStart, e);
    }
    // Trailing free time
    const dayEndMs = dayEnd.getTime();
    if (dayEndMs > freeStart) {
      const durationHours = (dayEndMs - freeStart) / 3_600_000;
      if (durationHours >= MIN_BLOCK_HOURS) {
        blocks.push({
          start: new Date(freeStart).toISOString(),
          end: dayEnd.toISOString(),
          durationHours,
        });
      }
    }

    // Advance to next day
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return blocks;
}

/** Summarise the coming week's calendar for Life Manager prompt injection */
export function buildCalendarSummary(): string {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
  const events = listCalendarEvents(now.toISOString(), weekEnd.toISOString());
  if (events.length === 0) return '<calendar>\nNo events in the next 7 days.\n</calendar>';

  const lines: string[] = [];
  for (const ev of events.slice(0, 20)) {
    const start = new Date(ev.start_at);
    const dateStr = ev.all_day
      ? start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : start.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    lines.push(`- ${dateStr}: ${ev.title}`);
  }

  const blocks = getAvailableBlocks(now.toISOString(), weekEnd.toISOString());
  const totalFreeHours = blocks.reduce((s, b) => s + b.durationHours, 0);

  return `<calendar>\nUpcoming events (next 7 days):\n${lines.join('\n')}\n\nEstimated free work hours this week: ~${totalFreeHours.toFixed(0)}h\n</calendar>`;
}
