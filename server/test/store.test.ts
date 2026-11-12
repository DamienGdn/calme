import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store.ts';
import { mail } from './fixtures.ts';

describe('store', () => {
  it('upserts messages once', () => {
    const s = openStore(':memory:');
    expect(s.upsertMessages([mail('a')])).toBe(1);
    expect(s.upsertMessages([mail('a')])).toBe(0);
  });

  it('lists only unanalyzed messages', () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a'), mail('b')]);
    s.saveAnalyses([{ id: 'a', category: 'reply', summary: ['x'], action: 'répondre', replies: [], group: null }]);
    expect(s.listUnanalyzed(10).map((m) => m.id)).toEqual(['b']);
  });

  it('counts analysed messages by category', () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a'), mail('b')]);
    s.saveAnalyses([{ id: 'a', category: 'reply', summary: [], action: '', replies: [], group: null }]);
    expect(s.counts()).toEqual({ reply: 1, read: 0, news: 0, trash: 0 });
  });

  it('removes messages from the inbox', () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a'), mail('b')]);
    s.removeFromInbox(['a']);
    expect(s.listInbox().map((m) => m.id)).toEqual(['b']);
    expect(s.getMail('a')).toBeNull();
  });

  it('filters inbox by category and returns analysis', () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a'), mail('b')]);
    s.saveAnalyses([{ id: 'b', category: 'news', summary: ['hebdo'], action: 'désabonner', replies: [], group: null }]);
    const news = s.listInbox('news');
    expect(news.map((m) => m.id)).toEqual(['b']);
    expect(news[0].analysis?.summary).toEqual(['hebdo']);
  });

  it('marks mails read or unread through the UNREAD label', () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a'), mail('b', { labelIds: ['INBOX', 'UNREAD'] })]);
    s.setUnread(['a'], true);
    s.setUnread(['b'], false);
    expect(s.getMail('a')?.labelIds).toEqual(['INBOX', 'UNREAD']);
    expect(s.getMail('b')?.labelIds).toEqual(['INBOX']);
    s.setUnread(['a'], true);
    expect(s.getMail('a')?.labelIds).toEqual(['INBOX', 'UNREAD']);
  });

  it('follows the unread state seen in Gmail for the inbox', () => {
    const s = openStore(':memory:');
    s.upsertMessages([mail('a'), mail('b', { labelIds: ['INBOX', 'UNREAD'] })]);
    s.syncUnread(new Set(['a']));
    expect(s.getMail('a')?.labelIds).toContain('UNREAD');
    expect(s.getMail('b')?.labelIds).not.toContain('UNREAD');
  });

  it('stores meta values and push subscriptions', () => {
    const s = openStore(':memory:');
    s.setMeta('lastSync', '123');
    expect(s.getMeta('lastSync')).toBe('123');
    s.addPushSub({ endpoint: 'https://push/1', keys: { p256dh: 'a', auth: 'b' } });
    expect(s.listPushSubs()).toHaveLength(1);
    s.removePushSub('https://push/1');
    expect(s.listPushSubs()).toHaveLength(0);
  });
});
