import type { Archive } from './archive.ts';
import type { GmailPort } from './gmail.ts';
import { parseGmailMessage } from './mime.ts';
import type { Store } from './store.ts';

const EXCLUDE = '-in:chats -in:spam -in:trash';

function afterDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Keeps the local mail base in step with Gmail:
 * 1. copies mails the inbox sync already fetched (free),
 * 2. adds mail from the last 2 days (received and sent),
 * 3. backfills older mail page by page, at most `batch` full fetches per call (60 quota units each), resuming next time.
 */
export async function syncArchive(
  g: GmailPort,
  s: Store,
  a: Archive,
  opts: { months: number; batch: number },
): Promise<{ added: number; done: boolean }> {
  let added = a.add(s.allMessages().filter((m) => !a.has(m.id)));

  const recent = await g.listPage(`newer_than:2d ${EXCLUDE}`);
  for (const id of recent.ids) if (!a.has(id)) added += a.add([parseGmailMessage(await g.get(id))]);

  const query = `after:${afterDate(opts.months)} ${EXCLUDE}`;
  // The day part of the query moves daily; only a change of depth restarts the backfill.
  if (s.getMeta('archiveMonths') !== String(opts.months)) {
    s.setMeta('archiveMonths', String(opts.months));
    s.setMeta('archiveDone', '0');
    s.setMeta('archivePageToken', '');
  }
  if (s.getMeta('archiveDone') === '1' || opts.months <= 0) return { added, done: true };

  let budget = opts.batch;
  for (;;) {
    const token = s.getMeta('archivePageToken') || undefined;
    const page = await g.listPage(query, token);
    const missing = page.ids.filter((id) => !a.has(id));
    for (const id of missing) {
      if (budget <= 0) return { added, done: false };
      added += a.add([parseGmailMessage(await g.get(id))]);
      budget--;
    }
    if (!page.next) {
      s.setMeta('archiveDone', '1');
      s.setMeta('archivePageToken', '');
      return { added, done: true };
    }
    s.setMeta('archivePageToken', page.next);
    if (budget <= 0) return { added, done: false };
  }
}
