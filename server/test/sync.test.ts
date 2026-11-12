import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store.ts';
import { syncInbox } from '../src/sync.ts';
import { fakeGmail } from './fakeGmail.ts';

describe('syncInbox', () => {
  it('fetches only unknown messages', async () => {
    const s = openStore(':memory:');
    const g = fakeGmail(['a', 'b']);
    expect(await syncInbox(g.port, s)).toEqual({ added: 2 });
    expect(await syncInbox(g.port, s)).toEqual({ added: 0 });
    expect(g.calls.filter((c) => c.method === 'get')).toHaveLength(2);
    expect(g.calls[0].args).toEqual(['in:inbox newer_than:30d', 200]);
  });

  it('drops locally what left the Gmail inbox', async () => {
    const s = openStore(':memory:');
    const g = fakeGmail(['a', 'b']);
    await syncInbox(g.port, s);
    g.state.ids = ['b'];
    await syncInbox(g.port, s);
    expect(s.listInbox().map((m) => m.id)).toEqual(['b']);
  });

  it('brings back a message returned to the Gmail inbox', async () => {
    const s = openStore(':memory:');
    const g = fakeGmail(['a']);
    await syncInbox(g.port, s);
    g.state.ids = [];
    await syncInbox(g.port, s);
    g.state.ids = ['a'];
    await syncInbox(g.port, s);
    expect(s.listInbox().map((m) => m.id)).toEqual(['a']);
  });

  it('follows what was read or marked unread in Gmail', async () => {
    const s = openStore(':memory:');
    const g = fakeGmail(['a', 'b']);
    g.state.unread = ['a'];
    await syncInbox(g.port, s);
    expect(s.listInbox().filter((m) => m.labelIds.includes('UNREAD')).map((m) => m.id)).toEqual(['a']);
    g.state.unread = ['b'];
    await syncInbox(g.port, s);
    expect(s.listInbox().filter((m) => m.labelIds.includes('UNREAD')).map((m) => m.id)).toEqual(['b']);
    expect(g.calls.some((c) => c.method === 'listInboxIds' && c.args[0] === 'in:inbox is:unread newer_than:30d')).toBe(true);
  });

  it('records the last sync time', async () => {
    const s = openStore(':memory:');
    await syncInbox(fakeGmail(['a']).port, s);
    expect(Number(s.getMeta('lastSync'))).toBeGreaterThan(0);
  });
});
