import { DatabaseSync } from 'node:sqlite';
import { CATEGORIES, type Analysis, type Category, type MailMessage, type MailView, type PushSub } from './types.ts';

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      date INTEGER NOT NULL,
      data TEXT NOT NULL,
      analysis TEXT,
      in_inbox INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS messages_date ON messages(date DESC);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, data TEXT NOT NULL);
  `);

  type Row = { data: string; analysis: string | null };
  const toView = (r: Row): MailView => ({ ...JSON.parse(r.data), analysis: r.analysis ? JSON.parse(r.analysis) : null });

  const insert = db.prepare('INSERT OR IGNORE INTO messages (id, date, data) VALUES (?, ?, ?)');
  const setAnalysis = db.prepare('UPDATE messages SET analysis = ? WHERE id = ?');

  return {
    db,

    upsertMessages(msgs: MailMessage[]): number {
      let added = 0;
      for (const m of msgs) added += Number(insert.run(m.id, m.date, JSON.stringify(m)).changes);
      return added;
    },

    allMessages(): MailMessage[] {
      return (db.prepare('SELECT data FROM messages').all() as { data: string }[]).map((r) => JSON.parse(r.data));
    },

    knownIds(): Set<string> {
      const rows = db.prepare('SELECT id FROM messages').all() as { id: string }[];
      return new Set(rows.map((r) => r.id));
    },

    inboxIds(): string[] {
      return (db.prepare('SELECT id FROM messages WHERE in_inbox = 1').all() as { id: string }[]).map((r) => r.id);
    },

    listUnanalyzed(limit: number): MailMessage[] {
      const rows = db
        .prepare('SELECT data FROM messages WHERE analysis IS NULL AND in_inbox = 1 ORDER BY date DESC LIMIT ?')
        .all(limit) as { data: string }[];
      return rows.map((r) => JSON.parse(r.data));
    },

    countUnanalyzed(): number {
      return Number((db.prepare('SELECT COUNT(*) n FROM messages WHERE analysis IS NULL AND in_inbox = 1').get() as { n: number }).n);
    },

    saveAnalyses(list: Analysis[]): void {
      for (const a of list) setAnalysis.run(JSON.stringify(a), a.id);
    },

    listInbox(cat?: Category): MailView[] {
      const rows = db.prepare('SELECT data, analysis FROM messages WHERE in_inbox = 1 ORDER BY date DESC').all() as Row[];
      const views = rows.map(toView);
      return cat ? views.filter((v) => v.analysis?.category === cat) : views;
    },

    getMail(id: string): MailView | null {
      const r = db.prepare('SELECT data, analysis FROM messages WHERE id = ? AND in_inbox = 1').get(id) as Row | undefined;
      return r ? toView(r) : null;
    },

    restoreToInbox(ids: string[]): void {
      const st = db.prepare('UPDATE messages SET in_inbox = 1 WHERE id = ?');
      for (const id of ids) st.run(id);
    },

    removeFromInbox(ids: string[]): void {
      const st = db.prepare('UPDATE messages SET in_inbox = 0 WHERE id = ?');
      for (const id of ids) st.run(id);
    },

    counts(): Record<Category, number> {
      const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
      for (const v of this.listInbox()) if (v.analysis) out[v.analysis.category]++;
      return out;
    },

    getMeta(key: string): string | null {
      const r = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
      return r ? r.value : null;
    },

    setMeta(key: string, value: string): void {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    },

    addPushSub(sub: PushSub): void {
      db.prepare('INSERT OR REPLACE INTO push_subs (endpoint, data) VALUES (?, ?)').run(sub.endpoint, JSON.stringify(sub));
    },

    listPushSubs(): PushSub[] {
      return (db.prepare('SELECT data FROM push_subs').all() as { data: string }[]).map((r) => JSON.parse(r.data));
    },

    removePushSub(endpoint: string): void {
      db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
    },
  };
}
