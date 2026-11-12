import { describe, expect, it } from 'vitest';
import { createNotifier } from '../src/notify.ts';
import { openReminders } from '../src/reminders.ts';
import { saveSettings } from '../src/settings.ts';
import { openStore } from '../src/store.ts';
import type { Analysis } from '../src/types.ts';
import { mail } from './fixtures.ts';

const reply = (id: string): Analysis => ({ id, category: 'reply', summary: [], action: '', replies: [], group: null });
const vapid = { publicKey: 'pub', privateKey: 'priv' };

describe('notifier', () => {
  it('warns the day before a reminder, then at its time, and keeps the alerts for the apps', async () => {
    const s = openStore(':memory:');
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    const r = openReminders(s.db);
    const due = new Date(2026, 10, 13, 9).getTime();
    r.add({ text: 'Compteur', due, early: 1440 }, 1);
    const sent: { title: string; body: string }[] = [];
    let now = new Date(2026, 10, 12, 9, 5);
    const n = createNotifier(s, vapid, async (_s, p) => {
      sent.push(JSON.parse(p));
    }, () => now);
    await n.notifyReminders(r);
    now = new Date(2026, 10, 13, 9, 1);
    await n.notifyReminders(r);
    expect(sent.map((p) => p.body)).toEqual(['Compteur', 'Compteur']);
    expect(sent[0].title).toMatch(/^Rappel · /);
    expect(sent[1].title).toBe('Rappel');
    expect(n.alerts().map((a) => a.title)).toEqual([sent[0].title, 'Rappel']);
  });

  it('pushes each due reminder once, and waits out the quiet hours', async () => {
    const s = openStore(':memory:');
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    const r = openReminders(s.db);
    r.add({ text: 'Compteur de chantier', due: 1000 }, 1);
    const sent: string[] = [];
    let hour = 3;
    const n = createNotifier(s, vapid, async (_s, p) => {
      sent.push(p);
    }, () => new Date(2026, 10, 12, hour));
    saveSettings(s, { quietStart: 22, quietEnd: 7 });
    await n.notifyReminders(r);
    expect(sent).toHaveLength(0);
    hour = 9;
    await n.notifyReminders(r);
    await n.notifyReminders(r);
    expect(sent.map((p) => JSON.parse(p))).toEqual([{ title: 'Rappel', body: 'Compteur de chantier', url: '/#/rappels', badge: 0 }]);
  });


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
    expect(JSON.parse(sent[0])).toMatchObject({ title: 'Sophie Martin', body: 'Dîner samedi ?', badge: 0 });
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

  it('follows the push mode and skips trash mails', async () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a', { subject: 'A' }), mail('b', { subject: 'B' }), mail('c', { subject: 'C' })]);
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    const sent: string[] = [];
    const n = createNotifier(s, vapid, async (_s, p) => {
      sent.push(JSON.parse(p).body);
    });
    const list: Analysis[] = [reply('a'), { ...reply('b'), category: 'read' }, { ...reply('c'), category: 'trash' }];
    s.setMeta('settings', JSON.stringify({ pushMode: 'all' }));
    await n.notifyReplies(list);
    expect(sent).toEqual(['A', 'B']);
    sent.length = 0;
    s.setMeta('settings', JSON.stringify({ pushMode: 'off' }));
    await n.notifyReplies(list);
    expect(sent).toEqual([]);
  });

  it('stays silent during quiet hours', async () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a')]);
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    s.setMeta('settings', JSON.stringify({ quietStart: 22, quietEnd: 7 }));
    const sent: string[] = [];
    const n = createNotifier(s, vapid, async (_s, p) => {
      sent.push(p);
    }, () => new Date(2026, 10, 11, 23, 30));
    await n.notifyReplies([reply('a')]);
    expect(sent).toEqual([]);
  });

  it('sends a test push to one device', async () => {
    const s = openStore(':memory:');
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'k', auth: 'a' } });
    const sent: string[] = [];
    const ok = await createNotifier(s, vapid, async (sub, p) => {
      sent.push(sub.endpoint + ' ' + JSON.parse(p).title);
    }).test('https://push/1');
    expect(ok).toBe(true);
    expect(sent[0]).toMatch(/^https:\/\/push\/1 /);
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
