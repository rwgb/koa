import { describe, it, expect, vi } from 'vitest';

vi.mock('../calendar/write.js', () => ({
  createEvent: vi.fn().mockResolvedValue('new-event-id'),
  updateEvent: vi.fn().mockResolvedValue(undefined),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createCalendarEventTool, updateCalendarEventTool, deleteCalendarEventTool } from '../agent/tools/calendar_write.js';

describe('createCalendarEventTool input validation', () => {
  it('returns an error string when summary is missing', async () => {
    const result = await createCalendarEventTool.execute({
      start: '2026-06-10T10:00:00Z',
      end: '2026-06-10T11:00:00Z',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error');
    expect(result as string).toContain('summary');
  });

  it('returns an error string when start >= end', async () => {
    const result = await createCalendarEventTool.execute({
      summary: 'Bad Times',
      start: '2026-06-10T11:00:00Z',
      end: '2026-06-10T10:00:00Z',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error');
    expect(result as string).toContain('before');
  });

  it('returns an error string when start equals end', async () => {
    const result = await createCalendarEventTool.execute({
      summary: 'Zero Duration',
      start: '2026-06-10T10:00:00Z',
      end: '2026-06-10T10:00:00Z',
    });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error');
  });

  it('succeeds with valid inputs and returns the event ID in the message', async () => {
    const result = await createCalendarEventTool.execute({
      summary: 'Valid Event',
      start: '2026-06-10T10:00:00Z',
      end: '2026-06-10T11:00:00Z',
    });
    expect(result as string).toContain('new-event-id');
  });
});

describe('updateCalendarEventTool input validation', () => {
  it('returns an error string when event_id is missing', async () => {
    const result = await updateCalendarEventTool.execute({ summary: 'New Title' });
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error');
    expect(result as string).toContain('event_id');
  });
});

describe('deleteCalendarEventTool input validation', () => {
  it('returns an error string when event_id is missing', async () => {
    const result = await deleteCalendarEventTool.execute({});
    expect(typeof result).toBe('string');
    expect(result as string).toContain('Error');
    expect(result as string).toContain('event_id');
  });
});
