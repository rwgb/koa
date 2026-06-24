import type { Tool } from '../../types/index.js';
import { createEvent, updateEvent, deleteEvent } from '../../calendar/write.js';

export const createCalendarEventTool: Tool = {
  name: 'create_calendar_event',
  description: 'Create a new event on the user\'s primary Google Calendar.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Event title' },
      start: { type: 'string', description: 'ISO 8601 start datetime (or date for all-day)' },
      end: { type: 'string', description: 'ISO 8601 end datetime (or date for all-day)' },
      description: { type: 'string', description: 'Optional event description' },
      location: { type: 'string', description: 'Optional event location' },
      all_day: { type: 'boolean', description: 'Set to true for all-day events' },
      time_zone: { type: 'string', description: 'IANA timezone name (e.g. America/New_York). Required when start/end lack a UTC offset.' },
    },
    required: ['summary', 'start', 'end'],
  },
  async execute(input) {
    const { summary, start, end, description, location, all_day, time_zone } = input as {
      summary?: unknown;
      start?: unknown;
      end?: unknown;
      description?: unknown;
      location?: unknown;
      all_day?: unknown;
      time_zone?: unknown;
    };

    if (!summary || typeof summary !== 'string') return 'Error: summary is required';
    if (!start || typeof start !== 'string') return 'Error: start is required';
    if (!end || typeof end !== 'string') return 'Error: end is required';
    if (start >= end) return 'Error: start must be before end';

    const eventId = await createEvent({
      summary,
      start,
      end,
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof location === 'string' ? { location } : {}),
      ...(all_day === true ? { allDay: true } : {}),
      ...(typeof time_zone === 'string' ? { timeZone: time_zone } : {}),
    });
    return `Created calendar event "${summary}" (id: ${eventId})`;
  },
};

export const updateCalendarEventTool: Tool = {
  name: 'update_calendar_event',
  description: 'Update an existing Google Calendar event by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Google Calendar event ID' },
      summary: { type: 'string', description: 'New event title' },
      start: { type: 'string', description: 'New ISO 8601 start datetime' },
      end: { type: 'string', description: 'New ISO 8601 end datetime' },
      description: { type: 'string', description: 'New event description' },
      location: { type: 'string', description: 'New event location' },
      time_zone: { type: 'string', description: 'IANA timezone name (e.g. America/New_York). Required when start/end lack a UTC offset.' },
    },
    required: ['event_id'],
  },
  async execute(input) {
    const { event_id, summary, start, end, description, location, time_zone } = input as {
      event_id?: unknown;
      summary?: unknown;
      start?: unknown;
      end?: unknown;
      description?: unknown;
      location?: unknown;
      time_zone?: unknown;
    };

    if (!event_id || typeof event_id !== 'string') return 'Error: event_id is required';

    await updateEvent(event_id, {
      ...(typeof summary === 'string' ? { summary } : {}),
      ...(typeof start === 'string' ? { start } : {}),
      ...(typeof end === 'string' ? { end } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof location === 'string' ? { location } : {}),
      ...(typeof time_zone === 'string' ? { timeZone: time_zone } : {}),
    });
    return `Updated calendar event ${event_id}`;
  },
};

export const deleteCalendarEventTool: Tool = {
  name: 'delete_calendar_event',
  description: 'Delete a Google Calendar event by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', description: 'Google Calendar event ID' },
    },
    required: ['event_id'],
  },
  async execute(input) {
    const { event_id } = input as { event_id?: unknown };
    if (!event_id || typeof event_id !== 'string') return 'Error: event_id is required';
    await deleteEvent(event_id);
    return `Deleted calendar event ${event_id}`;
  },
};
