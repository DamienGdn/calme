import { describe, expect, it } from 'vitest';
import { createNotifier } from '../src/notify.ts';
import { openStore } from '../src/store.ts';
import type { Analysis } from '../src/types.ts';
import { mail } from './fixtures.ts';

const reply = (id: string): Analysis => ({ id, category: 'reply', summary: [], action: '', replies: [], group: null });
const vapid = { publicKey: 'pub', privateKey: 'priv' };

describe('notifier', () => {
  it('sends one push per reply mail with sender and subject', async () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a', { subject: 'Dîner samedi ?' })]);
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    const sent: string[] = [];
    const n = createNotifier(s, vapid, async (_sub, payload) => {
      sent.push(payload);
    });
    await n.notifyReplies([reply('a'), { ...reply('x'), category: 'news' }]);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ title: 'Sophie Martin', body: 'Dîner samedi ?' });
  });

  it('groups more than 3 replies into a single push', async () => {
    const s = openStore(':memory:');
    s.upsertMessages(['a', 'b', 'c', 'd'].map((id) => mail(id)));
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    const sent: string[] = [];
    const n = createNotifier(s, vapid, async (_s, p) => {
      sent.push(p);
    });
    await n.notifyReplies(['a', 'b', 'c', 'd'].map(reply));
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).title).toBe('4 mails attendent ta réponse');
  });

  it('writes the grouped push in English when the app is in English', async () => {
    const s = openStore(':memory:');
    s.upsertMessages(['a', 'b', 'c', 'd'].map((id) => mail(id)));
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    s.setMeta('settings', JSON.stringify({ language: 'en' }));
    const sent: string[] = [];
    await createNotifier(s, vapid, async (_s, p) => {
      sent.push(p);
    }).notifyReplies(['a', 'b', 'c', 'd'].map(reply));
    expect(JSON.parse(sent[0]).title).toBe('4 mails are waiting for your answer');
  });

  it('drops expired subscriptions', async () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a')]);
    s.addPushSub({ endpoint: 'https://push/old', keys: { p256dh: 'k', auth: 'a' } });
    const n = createNotifier(s, vapid, async () => {
      throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    await n.notifyReplies([reply('a')]);
    expect(s.listPushSubs()).toHaveLength(0);
  });
});
