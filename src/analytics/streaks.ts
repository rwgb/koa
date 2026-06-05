import { getCompletionDates, getUpcomingTasks, listTasks } from '../db/index.js';
import type { Task } from '../db/index.js';

export interface WeeklyReport {
  completedThisWeek: number;
  completedLastWeek: number;
  velocityChange: number; // positive = improved
  currentStreak: number;
  upcomingDeadlines: Task[];
  openHighPriority: number;
}

/**
 * Given a list of YYYY-MM-DD strings (most-recent first), returns the length
 * of the current consecutive-day streak ending today or yesterday.
 *
 * A streak is only considered active if the most recent completion is today or
 * yesterday (giving a 48-hour grace window for late-night workers).
 */
export function computeStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const sorted = [...new Set(dates)].sort().reverse(); // unique, newest first

  if (sorted[0] !== todayStr && sorted[0] !== yesterdayStr) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!);
    const curr = new Date(sorted[i]!);
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function completionsInRange(dates: string[], startIso: string, endIso: string): number {
  return dates.filter((d) => d >= startIso && d <= endIso).length;
}

export function buildWeeklyReport(): WeeklyReport {
  const dates = getCompletionDates();
  const currentStreak = computeStreak(dates);

  const now = new Date();
  const dayMs = 86_400_000;

  // This week: Mon–today (ISO week, Mon-based)
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon…6=Sun
  const weekStart = new Date(now.getTime() - dayOfWeek * dayMs);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const todayStr = now.toISOString().slice(0, 10);

  // Last week: same window, offset -7 days
  const lastWeekStartStr = new Date(weekStart.getTime() - 7 * dayMs).toISOString().slice(0, 10);
  const lastWeekEndStr = new Date(weekStart.getTime() - dayMs).toISOString().slice(0, 10);

  const completedThisWeek = completionsInRange(dates, weekStartStr, todayStr);
  const completedLastWeek = completionsInRange(dates, lastWeekStartStr, lastWeekEndStr);

  const velocityChange = completedThisWeek - completedLastWeek;

  const upcomingDeadlines = getUpcomingTasks(7);
  const openHighPriority = listTasks({ status: 'todo' }).filter((t) => t.priority <= 2).length
    + listTasks({ status: 'in_progress' }).filter((t) => t.priority <= 2).length;

  return {
    completedThisWeek,
    completedLastWeek,
    velocityChange,
    currentStreak,
    upcomingDeadlines,
    openHighPriority,
  };
}

export function buildWeeklyReportSummary(report: WeeklyReport): string {
  const parts: string[] = [];

  parts.push(`## Weekly Snapshot`);

  const streakLine = report.currentStreak > 0
    ? `Current streak: **${report.currentStreak} day${report.currentStreak !== 1 ? 's' : ''}** of consecutive completions.`
    : `No active streak — no tasks completed today or yesterday.`;
  parts.push(streakLine);

  const velocityLine = report.velocityChange > 0
    ? `Velocity up ${report.velocityChange} vs last week (${report.completedThisWeek} this week, ${report.completedLastWeek} last week).`
    : report.velocityChange < 0
      ? `Velocity down ${Math.abs(report.velocityChange)} vs last week (${report.completedThisWeek} this week, ${report.completedLastWeek} last week).`
      : `Same pace as last week: ${report.completedThisWeek} tasks completed.`;
  parts.push(velocityLine);

  if (report.openHighPriority > 0) {
    parts.push(`${report.openHighPriority} high-priority task${report.openHighPriority !== 1 ? 's' : ''} still open (priority 1–2).`);
  }

  if (report.upcomingDeadlines.length > 0) {
    parts.push(`\nUpcoming deadlines (next 7 days):`);
    for (const t of report.upcomingDeadlines.slice(0, 5)) {
      parts.push(`- ${t.title} — due ${t.deadline}`);
    }
  }

  return parts.join('\n');
}
