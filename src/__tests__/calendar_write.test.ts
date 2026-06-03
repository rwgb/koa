import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../calendar/oauth.js', () => ({
  getCalendarAccessToken: vi.fn().mockResolvedValue('fake-token'),
}));

vi.mock('googleapis', () => {
  function OAuth2(this: Record<string, unknown>) {
    this['setCredentials'] = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2 },
      calendar: vi.fn(() => ({
        events: {
          insert: mockInsert,
          patch: mockPatch,
          delete: mockDelete,
        },
      })),
    },
  };
});

import { createEvent, updateEvent, deleteEvent } from '../calendar/write.js';

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ data: { id: 'event-abc-123' } });
  mockPatch.mockResolvedValue({ data: {} });
  mockDelete.mockResolvedValue({ data: {} });
});

describe('createEvent', () => {
  it('calls calendar.events.insert and returns the event ID', async () => {
    const id = await createEvent({
      summary: 'Team Sync',
      start: '2026-06-10T10:00:00Z',
      end: '2026-06-10T11:00:00Z',
    });

    expect(id).toBe('event-abc-123');
    expect(mockInsert).toHaveBeenCalledOnce();
    const rawCall = mockInsert.mock.calls[0];
    if (!rawCall) throw new Error('mockInsert not called');
    const call = rawCall[0] as { calendarId: string; requestBody: Record<string, unknown> };
    expect(call.calendarId).toBe('primary');
    expect(call.requestBody['summary']).toBe('Team Sync');
    expect((call.requestBody['start'] as Record<string, string>)['dateTime']).toBe('2026-06-10T10:00:00Z');
    expect((call.requestBody['end'] as Record<string, string>)['dateTime']).toBe('2026-06-10T11:00:00Z');
  });

  it('uses date format (not dateTime) for all-day events', async () => {
    await createEvent({
      summary: 'Holiday',
      start: '2026-06-15T00:00:00',
      end: '2026-06-16T00:00:00',
      allDay: true,
    });

    const rawCall2 = mockInsert.mock.calls[0];
    if (!rawCall2) throw new Error('mockInsert not called');
    const call = rawCall2[0] as { requestBody: Record<string, unknown> };
    expect((call.requestBody['start'] as Record<string, string>)['date']).toBe('2026-06-15');
    expect((call.requestBody['start'] as Record<string, unknown>)['dateTime']).toBeUndefined();
    expect((call.requestBody['end'] as Record<string, string>)['date']).toBe('2026-06-16');
  });

  it('includes optional description and location', async () => {
    await createEvent({
      summary: 'Offsite',
      start: '2026-07-01T09:00:00Z',
      end: '2026-07-01T17:00:00Z',
      description: 'Annual planning offsite',
      location: 'Cape Town',
    });

    const rawCall3 = mockInsert.mock.calls[0];
    if (!rawCall3) throw new Error('mockInsert not called');
    const call = rawCall3[0] as { requestBody: Record<string, unknown> };
    expect(call.requestBody['description']).toBe('Annual planning offsite');
    expect(call.requestBody['location']).toBe('Cape Town');
  });
});

describe('updateEvent', () => {
  it('calls calendar.events.patch with the correct eventId and patch data', async () => {
    await updateEvent('event-xyz', { summary: 'Updated Title' });

    expect(mockPatch).toHaveBeenCalledOnce();
    const rawPatch = mockPatch.mock.calls[0];
    if (!rawPatch) throw new Error('mockPatch not called');
    const call = rawPatch[0] as { calendarId: string; eventId: string; requestBody: Record<string, unknown> };
    expect(call.calendarId).toBe('primary');
    expect(call.eventId).toBe('event-xyz');
    expect(call.requestBody['summary']).toBe('Updated Title');
  });
});

describe('deleteEvent', () => {
  it('calls calendar.events.delete with the correct eventId', async () => {
    await deleteEvent('event-to-delete');

    expect(mockDelete).toHaveBeenCalledOnce();
    const rawDelete = mockDelete.mock.calls[0];
    if (!rawDelete) throw new Error('mockDelete not called');
    const call = rawDelete[0] as { calendarId: string; eventId: string };
    expect(call.calendarId).toBe('primary');
    expect(call.eventId).toBe('event-to-delete');
  });
});
