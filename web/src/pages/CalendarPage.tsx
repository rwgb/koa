import { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchCalendarEvents, fetchCalendarAvailability, triggerCalendarSync, updateTask } from '../api.js';
import type { CalendarEvent, CalendarBlock } from '../types.js';
import { Icon } from '../components/Icon.js';

// ── Date helpers ───────────────────────────────────────────────────────────────

function isoToDate(iso: string): Date {
  return new Date(iso);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

// ── Month grid ────────────────────────────────────────────────────────────────

interface MonthGridProps {
  year: number;
  month: number;        // 0-indexed
  events: CalendarEvent[];
  selectedDay: Date | null;
  onSelectDay: (d: Date) => void;
  onDeadlineDrop: (taskId: string, date: Date) => void;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  // Pad from Monday (ISO week) — Sunday = 0, Mon = 1, adjust so week starts Monday
  const startDow = (first.getDay() + 6) % 7;
  for (let i = 0; i < startDow; i++) {
    days.push(new Date(year, month, 1 - startDow + i));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  // Pad to full 6-row grid
  while (days.length % 7 !== 0) {
    days.push(new Date(year, month + 1, days.length - last.getDate() - startDow + 1));
  }
  return days;
}

function MonthGrid({ year, month, events, selectedDay, onSelectDay, onDeadlineDrop }: MonthGridProps) {
  const days = getDaysInMonth(year, month);
  const today = new Date();
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function eventsForDay(d: Date): CalendarEvent[] {
    return events.filter(e => sameDay(isoToDate(e.start_at), d));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent, d: Date) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onDeadlineDrop(taskId, d);
  }

  return (
    <div className="cal-grid">
      <div className="cal-grid__header">
        {DOW.map(d => <div key={d} className="cal-grid__dow">{d}</div>)}
      </div>
      <div className="cal-grid__body">
        {days.map((d) => {
          const inMonth = d.getMonth() === month;
          const isToday = sameDay(d, today);
          const isSelected = selectedDay ? sameDay(d, selectedDay) : false;
          const dayEvents = eventsForDay(d);

          return (
            <div
              key={d.toISOString()}
              className={[
                'cal-cell',
                inMonth ? '' : 'cal-cell--out',
                isToday ? 'cal-cell--today' : '',
                isSelected ? 'cal-cell--selected' : '',
              ].join(' ')}
              onClick={() => onSelectDay(d)}
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, d)}
            >
              <span className="cal-cell__num">{d.getDate()}</span>
              <div className="cal-cell__events">
                {dayEvents.slice(0, 3).map(ev => (
                  <div key={ev.id} className="cal-event-chip" title={ev.title}>
                    {ev.all_day ? '' : formatTime(ev.start_at) + ' '}
                    {ev.title}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="cal-event-chip cal-event-chip--more">+{dayEvents.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Agenda sidebar ────────────────────────────────────────────────────────────

interface AgendaProps {
  selectedDay: Date | null;
  events: CalendarEvent[];
  blocks: CalendarBlock[];
}

function Agenda({ selectedDay, events, blocks }: AgendaProps) {
  const day = selectedDay ?? new Date();
  const dayEvents = events.filter(e => sameDay(isoToDate(e.start_at), day));
  const dayBlocks = blocks.filter(b => sameDay(isoToDate(b.start), day));

  return (
    <aside className="cal-agenda">
      <h3 className="cal-agenda__title">
        {day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </h3>

      {dayEvents.length === 0 && (
        <p className="cal-agenda__empty">No events</p>
      )}
      <div className="cal-agenda__events">
        {dayEvents.map(ev => (
          <div key={ev.id} className="cal-agenda-item">
            <div className="cal-agenda-item__time">
              {ev.all_day ? 'All day' : `${formatTime(ev.start_at)} – ${formatTime(ev.end_at)}`}
            </div>
            <div className="cal-agenda-item__title">{ev.title}</div>
            {ev.location && (
              <div className="cal-agenda-item__loc">{ev.location}</div>
            )}
          </div>
        ))}
      </div>

      {dayBlocks.length > 0 && (
        <>
          <h4 className="cal-agenda__section">Free blocks</h4>
          <div className="cal-agenda__blocks">
            {dayBlocks.map((b, i) => (
              <div key={i} className="cal-block">
                <span className="cal-block__time">
                  {formatTime(b.start)} – {formatTime(b.end)}
                </span>
                <span className="cal-block__dur">{formatHours(b.durationHours)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<Date | null>(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthStart = useMemo(() => new Date(year, month, 1).toISOString(), [year, month]);
  const monthEnd = useMemo(() => new Date(year, month + 1, 1).toISOString(), [year, month]);

  const loadData = useCallback(async () => {
    const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString();
    setLoading(true);
    setError(null);
    try {
      const [evs, blks] = await Promise.all([
        fetchCalendarEvents(monthStart, monthEnd),
        fetchCalendarAvailability(new Date().toISOString(), weekEnd),
      ]);
      setEvents(evs);
      setBlocks(blks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [monthStart, monthEnd]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerCalendarSync();
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDeadlineDrop(taskId: string, date: Date) {
    try {
      await updateTask(taskId, { deadline: date.toISOString().slice(0, 10) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const monthLabel = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="cal-page">
      <div className="cal-topbar">
        <div className="cal-topbar__nav">
          <button className="cal-nav-btn" onClick={prevMonth} aria-label="Previous month">
            <Icon name="chevron-left" size={14} />
          </button>
          <span className="cal-topbar__month">{monthLabel}</span>
          <button className="cal-nav-btn" onClick={nextMonth} aria-label="Next month">
            <Icon name="chevron-right" size={14} />
          </button>
        </div>
        <div className="cal-topbar__actions">
          {error && <span className="cal-error">{error}</span>}
          <button
            className="cal-sync-btn"
            onClick={handleSync}
            disabled={syncing || loading}
            title="Pull latest events from Google Calendar"
          >
            <Icon name="calendar" size={14} />
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
        </div>
      </div>

      <div className="cal-body">
        {loading ? (
          <div className="cal-loading">Loading calendar…</div>
        ) : (
          <>
            <MonthGrid
              year={year}
              month={month}
              events={events}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onDeadlineDrop={handleDeadlineDrop}
            />
            <Agenda
              selectedDay={selectedDay}
              events={events}
              blocks={blocks}
            />
          </>
        )}
      </div>
    </div>
  );
}
