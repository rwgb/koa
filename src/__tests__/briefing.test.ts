import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  listCalendarEvents: vi.fn().mockReturnValue([
    { title: 'Team standup', start_at: '2026-06-03T09:00:00', end_at: '2026-06-03T09:15:00', all_day: 0 },
  ]),
  getUpcomingTasks: vi.fn().mockReturnValue([
    { id: '1', title: 'Ship CP10e', status: 'in_progress', deadline: '2026-06-04', priority: 1 },
  ]),
  listTasks: vi.fn().mockReturnValue([
    { id: '2', title: 'Old task', status: 'done', updated_at: new Date(Date.now() - 86_400_000).toISOString() },
  ]),
  getCompletionDates: vi.fn().mockReturnValue([
    new Date().toISOString().slice(0, 10),
    new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  ]),
}));

vi.mock('../analytics/streaks.js', () => ({
  computeStreak: vi.fn().mockReturnValue(2),
}));

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn().mockReturnValue([]),
}));

import { buildDailyBriefing } from '../proactive/briefing.js';

describe('buildDailyBriefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes calendar events', async () => {
    const result = await buildDailyBriefing();
    expect(result).toContain('event');
    expect(result).toContain('Team standup');
  });

  it('includes urgent tasks', async () => {
    const result = await buildDailyBriefing();
    expect(result).toContain('urgent');
    expect(result).toContain('Ship CP10e');
  });

  it('includes streak', async () => {
    const result = await buildDailyBriefing();
    expect(result).toContain('streak');
  });

  it('includes yesterday completions', async () => {
    const result = await buildDailyBriefing();
    expect(result).toContain('done yesterday');
  });

  it('caps output at 500 chars', async () => {
    const result = await buildDailyBriefing();
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
