import { listCalendarEvents, getUpcomingTasks, listTasks, getCompletionDates } from '../db/index.js';
import { computeStreak } from '../analytics/streaks.js';
import { loadIntegrations } from '../integrations/store.js';
import { getOpenPRs } from '../integrations/github.js';

export async function buildDailyBriefing(): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  const parts: string[] = [];

  // Calendar events today
  try {
    const events = listCalendarEvents(todayStart, todayEnd);
    if (events.length > 0) {
      const titles = events.slice(0, 3).map(e => e.title).join(', ');
      parts.push(`📅 ${events.length} event${events.length !== 1 ? 's' : ''}: ${titles}`);
    }
  } catch { /* calendar may not be configured */ }

  // Urgent tasks (due ≤48h)
  const urgent = getUpcomingTasks(2).filter(t => !['done', 'cancelled'].includes(t.status));
  if (urgent.length > 0) {
    parts.push(`⚡ ${urgent.length} urgent task${urgent.length !== 1 ? 's' : ''}: ${urgent.slice(0, 2).map(t => t.title).join(', ')}`);
  }

  // GitHub open PRs (if configured)
  try {
    const integrations = loadIntegrations();
    const gh = integrations.find(i => i.type === 'github');
    if (gh && gh.config['token'] && gh.config['defaultRepo']) {
      const [owner, repo] = String(gh.config['defaultRepo']).split('/');
      if (owner && repo) {
        const prs = await getOpenPRs(owner, repo, String(gh.config['token']));
        if (prs.length > 0) {
          parts.push(`🔀 ${prs.length} open PR${prs.length !== 1 ? 's' : ''}`);
        }
      }
    }
  } catch { /* github may not be configured */ }

  // Streak
  const dates = getCompletionDates();
  const streak = computeStreak(dates);
  if (streak > 0) {
    parts.push(`🔥 ${streak}-day streak`);
  }

  // Yesterday completions
  const completedYesterday = listTasks({ status: 'done' }).filter(t => t.updated_at.slice(0, 10) === yesterday).length;
  if (completedYesterday > 0) {
    parts.push(`✅ ${completedYesterday} done yesterday`);
  }

  if (parts.length === 0) {
    return 'Good morning! No urgent items today.';
  }

  const summary = `Good morning! ${parts.join(' · ')}`;
  // Cap at 500 chars for push-friendliness
  return summary.length > 500 ? summary.slice(0, 497) + '…' : summary;
}
