import { calendar as calendarApi } from '@googleapis/calendar';
import type { OAuth2Client } from 'google-auth-library';
import { GmailDisconnected } from './gmail.ts';
import { htmlToText } from './mime.ts';
import type { ProposedEvent } from './types.ts';

/** One of the user's Google calendars. */
export interface CalInfo {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  /** Calm may add appointments to it (owner or writer). */
  writable: boolean;
}

export interface CalEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Details shown when the appointment is opened. */
  id?: string;
  location?: string | null;
  description?: string | null;
  link?: string | null;
  /** The calendar the event belongs to. */
  calendar?: { id: string; name: string; color: string; primary: boolean };
}

/** An appointment to create. All-day: start and end are days (YYYY-MM-DD), the end day excluded, as Google wants. */
export interface NewEvent extends ProposedEvent {
  allDay?: boolean;
  /** Target calendar (the main one when absent). */
  calendarId?: string;
  description?: string;
  /** Popup reminder, minutes before the start. */
  reminderMin?: number;
}

/** Reminders the appointment form offers. */
export const REMINDERS = [10, 30, 60, 1440];

export interface CalendarPort {
  /** The user's calendars; `limited` when Google only lets Calm see the main one (permission not granted yet). */
  calendars(): Promise<{ list: CalInfo[]; limited: boolean }>;
  upcoming(days: number): Promise<CalEvent[]>;
  range(from: string, to: string): Promise<CalEvent[]>;
  create(e: NewEvent): Promise<{ link: string }>;
  /** Deletes an appointment (Google keeps it in the calendar's trash for 30 days). Guests are not notified. */
  remove(calendarId: string, eventId: string): Promise<void>;
}

export const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';

const fmtDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIMEZONE });
const fmtTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });

/** Plain-text agenda handed to Claude so suggested replies respect the user's availability. */
export function formatAgenda(events: CalEvent[]): string {
  if (!events.length) return 'Aucun événement dans les 14 prochains jours.';
  return events
    .map((e) => {
      if (e.allDay) return `- ${fmtDay.format(new Date(e.start + 'T12:00:00'))} (journée) : ${e.title}`;
      const s = new Date(e.start);
      return `- ${fmtDay.format(s)} ${fmtTime.format(s)}–${fmtTime.format(new Date(e.end))} : ${e.title}`;
    })
    .join('\n');
}

async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const err = e as { message?: string; status?: number };
    if (/invalid_grant|insufficient/i.test(err.message ?? '') || err.status === 401) throw new GmailDisconnected();
    throw e;
  }
}

const PRIMARY: CalInfo = { id: 'primary', name: '', color: '#039be5', primary: true, writable: true };

export function createCalendarPort(auth: OAuth2Client): CalendarPort {
  const api = calendarApi({ version: 'v3', auth });
  let cache: { at: number; value: { list: CalInfo[]; limited: boolean } } | null = null;
  const port: CalendarPort = {
    async calendars() {
      if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
      let value: { list: CalInfo[]; limited: boolean };
      try {
        const res = await api.calendarList.list({ maxResults: 250, minAccessRole: 'reader' });
        const list = (res.data.items ?? [])
          .filter((c) => c.id && !c.hidden && !c.deleted)
          .map((c) => ({
            id: c.id as string,
            name: c.summaryOverride || c.summary || (c.id as string),
            color: c.backgroundColor || '#039be5',
            primary: Boolean(c.primary),
            writable: c.accessRole === 'owner' || c.accessRole === 'writer',
          }))
          .sort((x, y) => Number(y.primary) - Number(x.primary) || x.name.localeCompare(y.name));
        value = { list: list.length ? list : [PRIMARY], limited: false };
      } catch (e) {
        // Not allowed to list calendars yet (the user has not reconnected since Calm asked for it): main one only.
        const err = e as { status?: number; code?: number; message?: string };
        if (err.status === 403 || err.code === 403 || /insufficient/i.test(err.message ?? '')) value = { list: [PRIMARY], limited: true };
        else {
          await guard(Promise.reject(e));
          throw e;
        }
      }
      cache = { at: Date.now(), value };
      return value;
    },
    async upcoming(days) {
      const now = new Date();
      return port.range(now.toISOString(), new Date(now.getTime() + days * 86400_000).toISOString());
    },
    async range(from, to) {
      const { list } = await port.calendars();
      const perCalendar = await Promise.all(
        list.map(async (cal) => {
          const res = await guard(
            api.events.list({ calendarId: cal.id, timeMin: from, timeMax: to, singleEvents: true, orderBy: 'startTime', maxResults: 250 }),
          );
          return (res.data.items ?? [])
            .filter((e) => e.status !== 'cancelled')
            .map((e) => ({
              title: e.summary || '(sans titre)',
              start: e.start?.dateTime ?? e.start?.date ?? '',
              end: e.end?.dateTime ?? e.end?.date ?? '',
              allDay: !e.start?.dateTime,
              id: e.id ?? undefined,
              location: e.location ?? null,
              // Google keeps notes as light HTML: shown as plain text.
              description: e.description ? (/<[a-z]/i.test(e.description) ? htmlToText(e.description) : e.description).slice(0, 4000) : null,
              link: e.htmlLink ?? null,
              calendar: { id: cal.id, name: cal.name, color: cal.color, primary: cal.primary },
            }));
        }),
      );
      return perCalendar.flat().sort((x, y) => x.start.localeCompare(y.start));
    },
    async create(e) {
      const res = await guard(
        api.events.insert({
          calendarId: e.calendarId ?? 'primary',
          requestBody: {
            summary: e.title,
            location: e.location ?? undefined,
            description: e.description || undefined,
            start: e.allDay ? { date: e.start } : { dateTime: e.start, timeZone: TIMEZONE },
            end: e.allDay ? { date: e.end } : { dateTime: e.end, timeZone: TIMEZONE },
            reminders: e.reminderMin === undefined ? undefined : { useDefault: false, overrides: [{ method: 'popup', minutes: e.reminderMin }] },
          },
        }),
      );
      return { link: res.data.htmlLink ?? '' };
    },
    async remove(calendarId, eventId) {
      await guard(api.events.delete({ calendarId, eventId, sendUpdates: 'none' }));
    },
  };
  return port;
}

/** "YYYY-MM-DD" + "HH:mm:ss" in local time → RFC 3339 with the local UTC offset (e.g. 2026-12-01T00:00:00+01:00). */
export function localIso(day: string, time: string): string {
  const off = -new Date(`${day}T${time}`).getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${day}T${time}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function bounds(e: CalEvent): [number, number] {
  if (!e.allDay) return [Date.parse(e.start), Date.parse(e.end)];
  // All-day events: busy from local midnight of the start date to midnight of the (exclusive) end date.
  return [new Date(e.start + 'T00:00:00').getTime(), new Date(e.end + 'T00:00:00').getTime()];
}

/** The first existing event that overlaps [start, end), or null. */
export function conflictWith(start: string, end: string, events: CalEvent[]): CalEvent | null {
  const s = Date.parse(start);
  const e = Date.parse(end);
  return events.find((ev) => {
    const [a, b] = bounds(ev);
    return s < b && e > a;
  }) ?? null;
}
