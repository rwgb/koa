import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { computeStreak, buildWeeklyReport } from '../analytics/streaks.js';
import { createProject, createTask, updateTask, closeDb } from '../db/index.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-streaks-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

// ── computeStreak ─────────────────────────────────────────────────────────────

describe('computeStreak', () => {
  it('returns 0 for empty input', () => {
    expect(computeStreak([])).toBe(0);
  });

  it('returns 0 when most recent date is older than yesterday', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect(computeStreak([twoDaysAgo])).toBe(0);
  });

  it('returns 1 for a single date of today', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(computeStreak([today])).toBe(1);
  });

  it('returns 1 for a single date of yesterday', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(computeStreak([yesterday])).toBe(1);
  });

  it('counts a continuous streak correctly', () => {
    const today = new Date();
    const dates = [0, 1, 2, 3].map((d) =>
      new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10),
    );
    expect(computeStreak(dates)).toBe(4);
  });

  it('stops at a gap in the streak', () => {
    const today = new Date();
    // today, yesterday, 3 days ago (gap at day 2)
    const dates = [0, 1, 3].map((d) =>
      new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10),
    );
    expect(computeStreak(dates)).toBe(2);
  });

  it('deduplicates repeated dates', () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(computeStreak([today, today, yesterday, yesterday])).toBe(2);
  });

  it('handles unordered input correctly', () => {
    const today = new Date();
    const dates = [2, 0, 1].map((d) =>
      new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10),
    );
    expect(computeStreak(dates)).toBe(3);
  });
});

// ── buildWeeklyReport ─────────────────────────────────────────────────────────

describe('buildWeeklyReport', () => {
  it('returns a report with zero completions on a fresh DB', () => {
    const report = buildWeeklyReport();
    expect(report.completedThisWeek).toBe(0);
    expect(report.completedLastWeek).toBe(0);
    expect(report.currentStreak).toBe(0);
    expect(Array.isArray(report.upcomingDeadlines)).toBe(true);
  });

  it('counts a task completed today in this week', () => {
    const p = createProject('streak-test');
    const t = createTask(p.id, 'Do a thing');
    updateTask(t.id, { status: 'done' });

    const report = buildWeeklyReport();
    expect(report.completedThisWeek).toBeGreaterThanOrEqual(1);
    expect(report.currentStreak).toBeGreaterThanOrEqual(1);
  });

  it('includes upcoming deadlines within 7 days', () => {
    const p = createProject('streak-deadlines');
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    createTask(p.id, 'Near deadline', { deadline: soon });

    const report = buildWeeklyReport();
    expect(report.upcomingDeadlines.some((t) => t.deadline === soon)).toBe(true);
  });
});
