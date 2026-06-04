import { google } from 'googleapis';
import { getCalendarAccessToken } from './oauth.js';

export interface CalendarEventDraft {
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  allDay?: boolean;
}

function buildEventResource(draft: Partial<CalendarEventDraft> & { summary?: string; start?: string; end?: string }) {
  const resource: Record<string, unknown> = {};
  if (draft.summary !== undefined) resource['summary'] = draft.summary;
  if (draft.description !== undefined) resource['description'] = draft.description;
  if (draft.location !== undefined) resource['location'] = draft.location;

  if (draft.start !== undefined) {
    resource['start'] = draft.allDay
      ? { date: draft.start.slice(0, 10) }
      : { dateTime: draft.start };
  }
  if (draft.end !== undefined) {
    resource['end'] = draft.allDay
      ? { date: draft.end.slice(0, 10) }
      : { dateTime: draft.end };
  }
  return resource;
}

async function makeCalendarClient() {
  const accessToken = await getCalendarAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth });
}

export async function createEvent(event: CalendarEventDraft): Promise<string> {
  const calendar = await makeCalendarClient();
  const resource = buildEventResource(event);
  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: resource,
  });
  const id = response.data.id;
  if (!id) throw new Error('Google Calendar returned no event ID');
  return id;
}

export async function updateEvent(eventId: string, patch: Partial<CalendarEventDraft>): Promise<void> {
  const calendar = await makeCalendarClient();
  const resource = buildEventResource(patch);
  await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: resource,
  });
}

export async function deleteEvent(eventId: string): Promise<void> {
  const calendar = await makeCalendarClient();
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
  });
}
