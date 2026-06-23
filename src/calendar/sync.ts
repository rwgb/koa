import { google } from 'googleapis';
import { getCalendarAccessToken, isCalendarConfigured } from './oauth.js';
import { upsertCalendarEvent, deleteCalendarEventsNotIn } from '../db/index.js';
import { loadIntegrations } from '../integrations/store.js';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
// Sync window: 7 days back, 30 days forward
const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 30;

export class CalendarSync {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  start(): void {
    if (this._running || !isCalendarConfigured()) return;
    this._running = true;
    void this._sync();
    this._timer = setInterval(() => { void this._sync(); }, SYNC_INTERVAL_MS);
    (this._timer as NodeJS.Timeout & { unref?: () => void }).unref?.();
  }

  stop(): void {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async syncNow(): Promise<void> {
    await this._sync();
  }

  private async _sync(): Promise<void> {
    const calendars = loadIntegrations().filter(
      i => i.type === 'google-calendar' && i.config['refreshToken'],
    );
    if (!calendars.length) return;
    for (const cal of calendars) {
      try {
        const accessToken = await getCalendarAccessToken(cal.id);
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        const calendar = google.calendar({ version: 'v3', auth });

        const now = new Date();
        const timeMin = new Date(now.getTime() - WINDOW_PAST_DAYS * 86_400_000).toISOString();
        const timeMax = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 86_400_000).toISOString();

        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 500,
        });

        const items = response.data.items ?? [];
        const googleIds: string[] = [];

        for (const item of items) {
          if (!item.id || item.status === 'cancelled') continue;
          const allDay = !!(item.start?.date && !item.start?.dateTime);
          const startAt = item.start?.dateTime ?? item.start?.date ?? '';
          const endAt = item.end?.dateTime ?? item.end?.date ?? '';
          if (!startAt || !endAt) continue;

          googleIds.push(item.id);
          const evData = {
            google_id: item.id,
            title: item.summary ?? '(no title)',
            start_at: startAt,
            end_at: endAt,
            all_day: allDay,
            attendees: (item.attendees ?? []).map(a => a.email ?? '').filter(Boolean),
            source_integration_id: cal.id,
          } as Parameters<typeof upsertCalendarEvent>[0];
          if (item.location) evData.location = item.location;
          if (item.description) evData.description = item.description;
          if (item.recurrence?.length) evData.recurrence = item.recurrence.join(';');
          upsertCalendarEvent(evData);
        }

        deleteCalendarEventsNotIn(googleIds, cal.id);
        process.stderr.write(`[calendar:${cal.id}] synced ${googleIds.length} events\n`);
      } catch (e) {
        process.stderr.write(`[calendar:${cal.id}] sync error: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
  }
}

export const calendarSync = new CalendarSync();
