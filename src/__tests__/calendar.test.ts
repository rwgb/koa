import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../db/index.js', () => ({
  listCalendarEvents: vi.fn(),
  upsertCalendarEvent: vi.fn(),
  deleteCalendarEventsNotIn: vi.fn(),
}));

vi.mock('../calendar/oauth.js', () => ({
  isCalendarConfigured: vi.fn(() => false),
}));

import { getConflicts, getAvailableBlocks, buildCalendarSummary } from '../calendar/conflicts.js';
import { listCalendarEvents } from '../db/index.js';

const mockEvents = vi.mocked(listCalendarEvents);

// Build a CalendarEvent on a given date (local time).
// startH/endH are 24h float hours (e.g. 9.5 = 9:30am).
function makeEvent(dateStr: string, startH: number, endH: number, title = 'Meeting', allDay = false) {
  const toHHMM = (h: number) => {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
  };
  // No 'Z' suffix → local time, which matches setHours() in the implementation
  const s = new Date(`${dateStr}T${toHHMM(startH)}`);
  const e = new Date(`${dateStr}T${toHHMM(endH)}`);
  return {
    id: `ev-${Math.random()}`,
    google_id: `g-${Math.random()}`,
    title,
    start_at: s.toISOString(),
    end_at: e.toISOString(),
    all_day: allDay,
    attendees: [],
    synced_at: new Date().toISOString(),
  };
}

// Returns local-midnight ISO string for a given YYYY-MM-DD date string
function localMidnight(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

// Returns local-midnight ISO string for N days after the given date
function localMidnightPlusDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const TODAY = '2026-06-10';

describe('getConflicts', () => {
  beforeEach(() => mockEvents.mockReturnValue([]));

  it('returns no conflict when task has no deadline', () => {
    const result = getConflicts({ deadline: null, effort_hours: 4 });
    expect(result.hasConflict).toBe(false);
  });

  it('returns no conflict on a free day', () => {
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 4 });
    expect(result.hasConflict).toBe(false);
    expect(result.busyHoursOnDeadlineDay).toBe(0);
  });

  it('returns no conflict when busy hours < threshold (< 4h)', () => {
    // 2 hours of meetings — below the 4-hour threshold
    mockEvents.mockReturnValue([makeEvent(TODAY, 10, 12)]);
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 6 });
    expect(result.hasConflict).toBe(false);
    expect(result.busyHoursOnDeadlineDay).toBeCloseTo(2);
  });

  it('detects conflict when day is busy and effort exceeds free time', () => {
    // 5 hours of meetings (9am-2pm), task needs 5h; free = 9h - 5h = 4h < 5h needed
    mockEvents.mockReturnValue([makeEvent(TODAY, 9, 14)]);
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 5 });
    expect(result.hasConflict).toBe(true);
    expect(result.reason).toContain('5.0h of meetings');
  });

  it('returns no conflict when effort fits in remaining free time', () => {
    // 5h meetings (9-2pm), 4h free, task only needs 2h
    mockEvents.mockReturnValue([makeEvent(TODAY, 9, 14)]);
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 2 });
    expect(result.hasConflict).toBe(false);
  });

  it('clips event overlap to work hours — event before 9am counts nothing', () => {
    // Event 6am-8am — entirely before work start
    mockEvents.mockReturnValue([makeEvent(TODAY, 6, 8)]);
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 8 });
    expect(result.busyHoursOnDeadlineDay).toBe(0);
  });

  it('ignores all-day events for conflict detection', () => {
    mockEvents.mockReturnValue([makeEvent(TODAY, 0, 0, 'All day', true)]);
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 9 });
    expect(result.busyHoursOnDeadlineDay).toBe(0);
  });

  it('returns at most 5 conflicting events', () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      makeEvent(TODAY, 9 + i * 0.8, 9.5 + i * 0.8),
    );
    mockEvents.mockReturnValue(events);
    const result = getConflicts({ deadline: `${TODAY}T23:59:59`, effort_hours: 1 });
    if (result.events) expect(result.events.length).toBeLessThanOrEqual(5);
  });
});

describe('getAvailableBlocks', () => {
  beforeEach(() => mockEvents.mockReturnValue([]));

  it('returns a 9-hour free block when no events on a work day', () => {
    mockEvents.mockReturnValue([]);
    const start = localMidnight(TODAY);
    const end = localMidnightPlusDays(TODAY, 1);
    const blocks = getAvailableBlocks(start, end);
    const totalHours = blocks.reduce((s, b) => s + b.durationHours, 0);
    expect(totalHours).toBeCloseTo(9, 0);
  });

  it('splits the work day around a midday meeting', () => {
    // Meeting 12pm-1pm
    mockEvents.mockReturnValue([makeEvent(TODAY, 12, 13)]);
    const start = localMidnight(TODAY);
    const end = localMidnightPlusDays(TODAY, 1);
    const blocks = getAvailableBlocks(start, end);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const totalHours = blocks.reduce((s, b) => s + b.durationHours, 0);
    expect(totalHours).toBeCloseTo(8, 0); // 9h - 1h meeting
  });

  it('excludes blocks shorter than 1 hour', () => {
    // Meetings leave a 30-minute gap (11:30-12:00)
    mockEvents.mockReturnValue([
      makeEvent(TODAY, 10, 11.5),  // 10am-11:30am
      makeEvent(TODAY, 12, 15),    // 12pm-3pm
    ]);
    const start = localMidnight(TODAY);
    const end = localMidnightPlusDays(TODAY, 1);
    const blocks = getAvailableBlocks(start, end);
    for (const b of blocks) {
      expect(b.durationHours).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns no blocks on a fully booked work day (9am-6pm)', () => {
    mockEvents.mockReturnValue([makeEvent(TODAY, 9, 18)]);
    const start = localMidnight(TODAY);
    const end = localMidnightPlusDays(TODAY, 1);
    const blocks = getAvailableBlocks(start, end);
    expect(blocks.length).toBe(0);
  });

  it('handles a 3-day range returning ~27 hours total free time', () => {
    mockEvents.mockReturnValue([]);
    const start = localMidnight(TODAY);
    const end = localMidnightPlusDays(TODAY, 3);
    const blocks = getAvailableBlocks(start, end);
    const totalHours = blocks.reduce((s, b) => s + b.durationHours, 0);
    expect(totalHours).toBeCloseTo(27, 0); // 3 days × 9h
  });
});

describe('buildCalendarSummary', () => {
  it('returns a <calendar>-tagged string', () => {
    mockEvents.mockReturnValue([]);
    const summary = buildCalendarSummary();
    expect(summary).toContain('<calendar>');
    expect(summary).toContain('</calendar>');
  });

  it('returns "No events" when DB is empty', () => {
    mockEvents.mockReturnValue([]);
    const summary = buildCalendarSummary();
    expect(summary).toContain('No events');
  });

  it('includes event titles in the summary', () => {
    mockEvents.mockReturnValue([makeEvent(TODAY, 10, 11, 'Team Standup')]);
    const summary = buildCalendarSummary();
    expect(summary).toContain('Team Standup');
  });

  it('caps the event list at 20 entries', () => {
    const events = Array.from({ length: 25 }, (_, i) =>
      makeEvent(TODAY, 9 + i * 0.2, 9.2 + i * 0.2, `Event ${i}`),
    );
    mockEvents.mockReturnValue(events);
    const summary = buildCalendarSummary();
    const lines = summary.split('\n').filter(l => l.trimStart().startsWith('- '));
    expect(lines.length).toBeLessThanOrEqual(20);
  });
});
