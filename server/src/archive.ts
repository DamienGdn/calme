import type { DatabaseSync } from 'node:sqlite';
import { parseAddressList } from './mime.ts';
import type { MailMessage } from './types.ts';

export interface ArchivedMail {
  id: string;
  threadId: string;
  date: number;
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  text: string;
  labels: string[];
  attachmentNames: string[];
}

export interface Contact {
  name: string;
  email: string;
  sent: number;
  received: number;
  last: number;
}

export type Archive = ReturnType<typeof openArchive>;

/** Turns free text into a safe FTS5 query: each word becomes a quoted prefix term (AND by default). */
export function ftsQuery(q: string, mode: 'and' | 'or' = 'and'): string {
  const words = q
    .normalize('NFC')
    .split(/[^\p{L}\p{N}@.]+/u)
    .map((w) => w.replace(/^[.@]+|[.@]+$/g, ''))
    .filter((w) => w.length > 1 && !/^(AND|OR|NOT|NEAR)$/.test(w))
    .slice(0, 12);
  return words.map((w) => `"${w.replace(/"/g, '')}"*`).join(mode === 'or' ? ' OR ' : ' ');
}

/** Local copy of the mailbox (received and sent), with full-text search and a contact book. */
export function openArchive(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS archive (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, date INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS archive_date ON archive(date DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS archive_fts USING fts5(
      id UNINDEXED, subject, sender, recipients, body, tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO archive (id, data, date) VALUES (?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO archive_fts (id, subject, sender, recipients, body) VALUES (?, ?, ?, ?, ?)');
  const toArchived = (m: MailMessage): ArchivedMail => ({
    id: m.id,
    threadId: m.threadId,
    date: m.date,
    fromName: m.fromName,
    fromEmail: m.fromEmail,
    to: m.to,
    cc: m.cc ?? '',
    subject: m.subject,
    snippet: m.snippet,
    text: m.text,
    labels: m.labelIds,
    attachmentNames: m.attachmentNames,
  });

  return {
    add(msgs: MailMessage[]): number {
      let n = 0;
      for (const m of msgs) {
        const a = toArchived(m);
        if (Number(insert.run(a.id, JSON.stringify(a), a.date).changes)) {
          insertFts.run(a.id, a.subject, `${a.fromName} ${a.fromEmail}`, `${a.to} ${a.cc}`, a.text.slice(0, 20_000));
          n++;
        }
      }
      return n;
    },

    has(id: string): boolean {
      return Boolean(db.prepare('SELECT 1 FROM archive WHERE id = ?').get(id));
    },

    get(id: string): ArchivedMail | null {
      const r = db.prepare('SELECT data FROM archive WHERE id = ?').get(id) as { data: string } | undefined;
      return r ? JSON.parse(r.data) : null;
    },

    count(): number {
      return Number((db.prepare('SELECT COUNT(*) n FROM archive').get() as { n: number }).n);
    },

    oldest(): number | null {
      const r = db.prepare('SELECT MIN(date) d FROM archive').get() as { d: number | null };
      return r.d ?? null;
    },

    search(q: string, limit: number, mode: 'and' | 'or' = 'and'): ArchivedMail[] {
      const match = ftsQuery(q, mode);
      if (!match) return [];
      const rows = db
        .prepare(
          `SELECT a.data FROM archive_fts f JOIN archive a ON a.id = f.id
           WHERE archive_fts MATCH ? ORDER BY bm25(archive_fts, 0, 6, 4, 2, 1), a.date DESC LIMIT ?`,
        )
        .all(match, limit) as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    withContact(email: string, limit: number): ArchivedMail[] {
      const rows = db
        .prepare(`SELECT a.data FROM archive_fts f JOIN archive a ON a.id = f.id WHERE archive_fts MATCH ? ORDER BY a.date DESC LIMIT ?`)
        .all(`{sender recipients} : "${email.replace(/"/g, '')}"`, limit) as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    /** People from received senders and from recipients of sent mail (weighted higher: they are real correspondents). */
    contacts(q: string, limit: number, me: string): Contact[] {
      const byEmail = new Map<string, Contact>();
      const bump = (name: string, email: string, field: 'sent' | 'received', date: number) => {
        const key = email.toLowerCase();
        if (!key || key === me.toLowerCase() || /no-?reply|mailer-daemon|notifications?@/i.test(key)) return;
        const c = byEmail.get(key) ?? { name, email: key, sent: 0, received: 0, last: 0 };
        c[field]++;
        if (date >= c.last) {
          c.last = date;
          if (name && name !== key) c.name = name;
        }
        byEmail.set(key, c);
      };
      const rows = db.prepare('SELECT data FROM archive ORDER BY date DESC LIMIT 20000').all() as { data: string }[];
      for (const r of rows) {
        const m: ArchivedMail = JSON.parse(r.data);
        const sentByMe = m.labels.includes('SENT') || m.fromEmail === me.toLowerCase();
        if (sentByMe) for (const p of [...parseAddressList(m.to), ...parseAddressList(m.cc)]) bump(p.name, p.email, 'sent', m.date);
        else bump(m.fromName, m.fromEmail, 'received', m.date);
      }
      const needle = q.trim().toLowerCase();
      return [...byEmail.values()]
        .filter((c) => !needle || c.email.includes(needle) || c.name.toLowerCase().includes(needle))
        .sort((a, b) => Number(b.sent > 0) - Number(a.sent > 0) || b.sent * 3 + b.received - (a.sent * 3 + a.received) || b.last - a.last)
        .slice(0, limit);
    },
  };
}
