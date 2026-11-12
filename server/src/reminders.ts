import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Reminders: things to do later, often taken from a mail ("look at buying a site electricity meter"). Kept in Calm's
 * own database; a phone notification goes out once when one falls due (again if its date is moved).
 */
export interface Reminder {
  id: string;
  text: string;
  /** When to be reminded (ms), or null for "someday". */
  due: number | null;
  /** Also warn this many minutes before (0: only at the time; 60: an hour before; 1440: the day before). */
  early: number;
  /** The mail it came from, when there is one (it may have left the inbox since). */
  mailId: string | null;
  mailSubject: string | null;
  mailFrom: string | null;
  createdAt: number;
  done: boolean;
  doneAt: number | null;
  /** The notification for this due date went out. */
  notified: boolean;
  /** The early warning for this due date went out. */
  notifiedEarly: boolean;
}

/** How long before the time a reminder may also warn, in minutes. */
export const EARLY = [0, 60, 1440];

export interface NewReminder {
  text: string;
  due: number | null;
  early?: number;
  mail?: { id: string; subject: string; fromName: string };
}

export type Reminders = ReturnType<typeof openReminders>;

/** Open first, by date (undated after), then the done ones, latest first. */
function order(a: Reminder, b: Reminder): number {
  if (a.done !== b.done) return a.done ? 1 : -1;
  if (a.done) return (b.doneAt ?? 0) - (a.doneAt ?? 0);
  if (a.due !== b.due) return a.due === null ? 1 : b.due === null ? -1 : a.due - b.due;
  return a.createdAt - b.createdAt;
}

export function openReminders(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  const all = () => (db.prepare('SELECT data FROM reminders').all() as { data: string }[]).map((r) => ({ early: 0, notifiedEarly: false, ...JSON.parse(r.data) }) as Reminder);
  const put = (r: Reminder) => db.prepare('INSERT OR REPLACE INTO reminders (id, data) VALUES (?, ?)').run(r.id, JSON.stringify(r));

  return {
    list(): Reminder[] {
      return all().sort(order);
    },

    get(id: string): Reminder | null {
      const r = db.prepare('SELECT data FROM reminders WHERE id = ?').get(id) as { data: string } | undefined;
      return r ? { early: 0, notifiedEarly: false, ...JSON.parse(r.data) } : null;
    },

    add(n: NewReminder, now = Date.now()): Reminder {
      const r: Reminder = {
        id: randomUUID(),
        text: n.text,
        due: n.due,
        early: n.early ?? 0,
        mailId: n.mail?.id ?? null,
        mailSubject: n.mail?.subject ?? null,
        mailFrom: n.mail?.fromName ?? null,
        createdAt: now,
        done: false,
        doneAt: null,
        notified: false,
        notifiedEarly: false,
      };
      put(r);
      return r;
    },

    update(id: string, patch: { text?: string; due?: number | null; early?: number; done?: boolean }, now = Date.now()): Reminder | null {
      const r = this.get(id);
      if (!r) return null;
      const next = { ...r };
      if (patch.text !== undefined) next.text = patch.text;
      if (patch.due !== undefined && patch.due !== r.due) {
        next.due = patch.due;
        next.notified = false;
        next.notifiedEarly = false;
      }
      if (patch.early !== undefined && patch.early !== r.early) {
        next.early = patch.early;
        next.notifiedEarly = false;
      }
      if (patch.done !== undefined && patch.done !== r.done) {
        next.done = patch.done;
        next.doneAt = patch.done ? now : null;
      }
      put(next);
      return next;
    },

    remove(id: string): boolean {
      return Number(db.prepare('DELETE FROM reminders WHERE id = ?').run(id).changes) > 0;
    },

    /** Open reminders whose date has come and that were not notified yet. */
    due(now = Date.now()): Reminder[] {
      return all().filter((r) => !r.done && !r.notified && r.due !== null && r.due <= now).sort(order);
    },

    /** Open reminders whose early warning time has come (before their date) and that were not warned yet. */
    soon(now = Date.now()): Reminder[] {
      return all()
        .filter((r) => !r.done && !r.notifiedEarly && r.early > 0 && r.due !== null && r.due - r.early * 60_000 <= now && now < r.due)
        .sort(order);
    },

    markNotified(ids: string[], kind: 'due' | 'early' = 'due'): void {
      for (const id of ids) {
        const r = this.get(id);
        if (r) put(kind === 'due' ? { ...r, notified: true } : { ...r, notifiedEarly: true });
      }
    },
  };
}
