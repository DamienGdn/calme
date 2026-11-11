import type { GmailPort } from './gmail.ts';
import { buildMime, type OutgoingAttachment } from './mime.ts';
import type { Store } from './store.ts';
import type { MailView, Unsub } from './types.ts';

export const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

export class NotFound extends Error {}

function need(s: Store, id: string): MailView {
  const m = s.getMail(id);
  if (!m) throw new NotFound(`Mail ${id} introuvable`);
  return m;
}

export async function archive(g: GmailPort, s: Store, id: string) {
  need(s, id);
  await g.modify(id, [], ['INBOX']);
  s.removeFromInbox([id]);
}

export async function trash(g: GmailPort, s: Store, id: string) {
  need(s, id);
  await g.trash(id);
  s.removeFromInbox([id]);
}

/** Undo of trash: Gmail restores the mail's labels, and Calme shows it in the inbox again. */
export async function untrash(g: GmailPort, s: Store, id: string) {
  if (!s.known(id)) throw new NotFound(`Mail ${id} introuvable`);
  await g.untrash(id);
  s.restoreToInbox([id]);
}

export async function label(g: GmailPort, s: Store, id: string, labelId: string) {
  need(s, id);
  await g.modify(id, [labelId], ['INBOX']);
  s.removeFromInbox([id]);
}

export interface ReplyInput {
  mailId?: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  attachments: OutgoingAttachment[];
}

/** Sends a new mail, or a threaded reply when mailId is given (the original is then archived: it has been dealt with). */
export async function sendReply(g: GmailPort, s: Store, i: ReplyInput, fromEmail: string) {
  const orig = i.mailId ? need(s, i.mailId) : null;
  const raw = buildMime({
    from: fromEmail,
    to: i.to,
    cc: i.cc,
    subject: i.subject,
    body: i.body,
    inReplyTo: orig?.messageIdHeader || undefined,
    references: orig ? [orig.references, orig.messageIdHeader].filter(Boolean).join(' ') || undefined : undefined,
    attachments: i.attachments,
  });
  await g.send(raw, orig?.threadId || undefined);
  if (orig) await archive(g, s, orig.id);
}

function isPublicHttps(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|0\.)/i.test(h) && !h.endsWith('.local');
  } catch {
    return false;
  }
}

export async function unsubscribe(
  g: GmailPort,
  s: Store,
  sender: string,
  fromEmail: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ done: boolean; url?: string }> {
  const who = sender.toLowerCase();
  const latest = s.listInbox().find((m) => m.fromEmail === who && m.unsub);
  const scanned = (JSON.parse(s.getMeta('newsletters') ?? '[]') as { fromEmail: string; unsub: Unsub }[]).find((n) => n.fromEmail === who);
  const u = latest?.unsub ?? scanned?.unsub;
  if (!u) return { done: false };
  const r = await unsubscribeWith(g, u, fromEmail, fetchImpl);
  if (r.done) {
    const set = new Set<string>(JSON.parse(s.getMeta('unsubscribed') ?? '[]'));
    set.add(who);
    s.setMeta('unsubscribed', JSON.stringify([...set]));
  }
  return r;
}

export async function unsubscribeWith(
  g: GmailPort,
  u: Unsub,
  fromEmail: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ done: boolean; url?: string }> {
  if (u.oneClickUrl && isPublicHttps(u.oneClickUrl)) {
    const res = await fetchImpl(u.oneClickUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'follow',
    });
    if (res.ok) return { done: true };
  }
  if (u.mailto) {
    const [addr, query = ''] = u.mailto.split('?');
    const params = new URLSearchParams(query);
    await g.send(
      buildMime({
        from: fromEmail,
        to: decodeURIComponent(addr),
        subject: params.get('subject') || 'unsubscribe',
        body: params.get('body') || 'unsubscribe',
        attachments: [],
      }),
    );
    return { done: true };
  }
  const url = u.httpUrl ?? u.oneClickUrl;
  return url && /^https?:/i.test(url) ? { done: false, url } : { done: false };
}

export function cleanupView(s: Store) {
  const groups = new Map<string, string[]>();
  const senders = new Map<string, { fromName: string; fromEmail: string; ids: string[]; canUnsub: boolean }>();
  for (const m of s.listInbox()) {
    if (m.analysis?.category === 'trash') {
      const k = m.analysis.group || 'Divers';
      groups.set(k, [...(groups.get(k) ?? []), m.id]);
    } else if (m.analysis?.category === 'news') {
      const cur = senders.get(m.fromEmail) ?? { fromName: m.fromName, fromEmail: m.fromEmail, ids: [], canUnsub: false };
      cur.ids.push(m.id);
      cur.canUnsub ||= Boolean(m.unsub);
      senders.set(m.fromEmail, cur);
    }
  }
  return {
    groups: [...groups].map(([group, ids]) => ({ group, count: ids.length, ids })).sort((a, b) => b.count - a.count),
    newsletters: [...senders.values()].map((n) => ({ ...n, count: n.ids.length })).sort((a, b) => b.count - a.count),
  };
}
