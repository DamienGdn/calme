import type { gmail_v1 } from '@googleapis/gmail';
import type { GmailPort } from '../src/gmail.ts';

export function rawMessage(id: string, extraHeaders: Record<string, string> = {}): gmail_v1.Schema$Message {
  return {
    id,
    threadId: 't-' + id,
    internalDate: '1762851600000',
    labelIds: ['INBOX'],
    snippet: 'snip ' + id,
    payload: {
      mimeType: 'text/plain',
      headers: Object.entries({ From: 'Sophie <s@x.fr>', Subject: 'Sujet ' + id, 'Message-ID': `<${id}@x.fr>`, ...extraHeaders }).map(
        ([name, value]) => ({ name, value }),
      ),
      body: { data: Buffer.from('corps ' + id).toString('base64url') },
    },
  };
}

export function fakeGmail(ids: string[] = []) {
  const calls: { method: string; args: unknown[] }[] = [];
  const state = { ids: [...ids], pages: {} as Record<string, { ids: string[]; next?: string }> };
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  const port: GmailPort = {
    async listInboxIds(q, max) {
      record('listInboxIds', q, max);
      return state.ids;
    },
    async listPage(q, pageToken) {
      record('listPage', q, pageToken);
      const key = q.startsWith('newer_than:2d') ? 'recent' : pageToken ?? 'first';
      return state.pages[key] ?? { ids: [] };
    },
    async listByLabel(labelId, max) {
      record('listByLabel', labelId, max);
      return ['f1', 'f2'];
    },
    async getHeaders(id): Promise<Record<string, string>> {
      record('getHeaders', id);
      const n = Number(id.replace(/\D/g, '')) || 0;
      if (id.startsWith('plain')) return { From: 'Ami <ami@x.fr>' };
      return {
        From: n % 2 ? 'La Gazette <news@gazette.fr>' : 'Promo <promo@shop.fr>',
        'List-Unsubscribe': n % 2 ? '<https://gazette.fr/u>' : '<mailto:u@shop.fr>',
        'List-Unsubscribe-Post': n % 2 ? 'List-Unsubscribe=One-Click' : '',
        Date: 'Mon, 9 Nov 2026 10:00:00 +0100',
        Subject: 'Édition ' + n,
        __labels: n === 1 ? 'INBOX' : 'INBOX,UNREAD',
      };
    },
    async get(id) {
      record('get', id);
      return rawMessage(id);
    },
    async modify(id, add, remove) {
      record('modify', id, add, remove);
    },
    async trash(id) {
      record('trash', id);
    },
    async send(raw, threadId) {
      record('send', raw, threadId);
    },
    async listLabels() {
      return [{ id: 'Label_1', name: 'Factures' }];
    },
    async profileEmail() {
      return 'moi@x.fr';
    },
  };
  return { port, calls, state };
}
