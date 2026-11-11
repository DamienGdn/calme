import type { GmailPort } from './gmail.ts';
import { parseGmailMessage } from './mime.ts';
import type { Store } from './store.ts';

export const INBOX_QUERY = 'in:inbox newer_than:30d';
export const INBOX_MAX = 200;

export async function syncInbox(g: GmailPort, s: Store): Promise<{ added: number }> {
  const remote = await g.listInboxIds(INBOX_QUERY, INBOX_MAX);
  const remoteSet = new Set(remote);
  s.removeFromInbox(s.inboxIds().filter((id) => !remoteSet.has(id)));
  const known = s.knownIds();
  const local = new Set(s.inboxIds());
  s.restoreToInbox(remote.filter((id) => known.has(id) && !local.has(id)));
  const fresh = [];
  for (const id of remote) if (!known.has(id)) fresh.push(parseGmailMessage(await g.get(id)));
  const added = s.upsertMessages(fresh);
  s.setMeta('lastSync', String(Date.now()));
  return { added };
}
