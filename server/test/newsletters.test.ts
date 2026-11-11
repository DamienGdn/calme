import { describe, expect, it } from 'vitest';
import type { ClaudeRunner } from '../src/claude.ts';
import { adviseNewsletters, autoUnsubscribe, scanNewsletters } from '../src/newsletters.ts';
import { getSettings, saveSettings } from '../src/settings.ts';
import { openStore } from '../src/store.ts';
import type { Analysis } from '../src/types.ts';
import { fakeGmail } from './fakeGmail.ts';
import { mail } from './fixtures.ts';

const ok = async () => new Response('ok');

describe('scanNewsletters', () => {
  it('groups senders that offer an unsubscribe link', async () => {
    const g = fakeGmail(['n1', 'n2', 'n3', 'plain1']);
    const s = openStore(':memory:');
    const list = await scanNewsletters(g.port, s);
    expect(list).toEqual([
      expect.objectContaining({ fromEmail: 'news@gazette.fr', fromName: 'La Gazette', count: 2, canUnsub: true }),
      expect.objectContaining({ fromEmail: 'promo@shop.fr', count: 1, canUnsub: true }),
    ]);
    expect(g.calls[0].args[0]).toMatch(/newer_than:30d/);
    expect(list[0]).toMatchObject({ read: 1, ids: ['n1', 'n3'], subjects: ['Édition 1', 'Édition 3'] });
    expect(list[1]).toMatchObject({ read: 0 });
    expect(JSON.parse(s.getMeta('newsletters') ?? '[]')).toHaveLength(2);
  });
});

describe('settings', () => {
  it('defaults to no automatic unsubscribe', () => {
    const s = openStore(':memory:');
    expect(getSettings(s, { model: 'sonnet', intervalMin: 5 })).toEqual({ autoUnsubscribe: false, keepSenders: [], archiveMonths: 12, language: 'fr', pushMode: 'reply', quietStart: null, quietEnd: null, remoteImages: true, model: 'sonnet', intervalMin: 5 });
  });
  it('rejects invalid values', () => {
    const s = openStore(':memory:');
    expect(() => saveSettings(s, { model: 'gpt' as never })).toThrow();
    expect(() => saveSettings(s, { intervalMin: 0 })).toThrow();
    expect(() => saveSettings(s, { archiveMonths: 5 })).toThrow();
    expect(() => saveSettings(s, { language: 'de' as never })).toThrow();
    expect(() => saveSettings(s, { pushMode: 'loud' as never })).toThrow();
    expect(() => saveSettings(s, { quietStart: 25 })).toThrow();
    saveSettings(s, { archiveMonths: 24 });
    expect(getSettings(s, { model: 'sonnet', intervalMin: 5 }).archiveMonths).toBe(24);
    saveSettings(s, { keepSenders: ['  News@X.fr '] });
    expect(getSettings(s, { model: 'sonnet', intervalMin: 5 }).keepSenders).toEqual(['news@x.fr']);
  });
});

describe('autoUnsubscribe', () => {
  const news = (id: string): Analysis => ({ id, category: 'news', summary: [], action: '', replies: [], group: null });
  function setup() {
    const s = openStore(':memory:');
    s.upsertMessages([
      mail('a', { fromEmail: 'news@gazette.fr', unsub: { oneClickUrl: 'https://gazette.fr/u' } }),
      mail('b', { fromEmail: 'keep@club.fr', unsub: { oneClickUrl: 'https://club.fr/u' } }),
    ]);
    return { s, g: fakeGmail() };
  }

  it('does nothing when disabled', async () => {
    const { s, g } = setup();
    const fetched: string[] = [];
    const done = await autoUnsubscribe(g.port, s, [news('a')], 'moi@x.fr', async (u) => (fetched.push(String(u)), new Response('ok')));
    expect(done).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it('unsubscribes new newsletters once, except kept senders', async () => {
    const { s, g } = setup();
    saveSettings(s, { autoUnsubscribe: true, keepSenders: ['keep@club.fr'] });
    expect(await autoUnsubscribe(g.port, s, [news('a'), news('b')], 'moi@x.fr', ok)).toEqual(['news@gazette.fr']);
    expect(await autoUnsubscribe(g.port, s, [news('a')], 'moi@x.fr', ok)).toEqual([]);
  });
});

describe('adviseNewsletters', () => {
  const senders = [
    { fromName: 'Promo', fromEmail: 'promo@shop.fr', count: 40, read: 0, lastRead: 0, lastDate: 1, subjects: ['-40 %'], ids: [], unsub: {}, canUnsub: true },
    { fromName: 'Club', fromEmail: 'club@foot.fr', count: 10, read: 9, lastRead: 1, lastDate: 1, subjects: ['Entraînement'], ids: [], unsub: {}, canUnsub: true },
  ];

  it('adds Claude verdicts and reasons, ignoring unknown senders and verdicts', async () => {
    const calls: string[] = [];
    const r: ClaudeRunner = async (i) => {
      calls.push(i.prompt);
      return {
        items: [
          { fromEmail: 'promo@shop.fr', verdict: 'unsub', reason: 'Jamais lue.' },
          { fromEmail: 'club@foot.fr', verdict: 'nope', reason: 'x' },
          { fromEmail: 'evil@x.fr', verdict: 'unsub', reason: 'x' },
        ],
      };
    };
    const out = await adviseNewsletters(r, senders);
    expect(calls[0]).toContain('promo@shop.fr');
    expect(calls[0]).toContain('lus 0/40');
    expect(out[0]).toMatchObject({ verdict: 'unsub', reason: 'Jamais lue.' });
    expect(out[1]).toMatchObject({ verdict: null, reason: '' });
    expect(out).toHaveLength(2);
  });

  it('keeps senders without verdict when Claude fails', async () => {
    const out = await adviseNewsletters(async () => { throw new Error('quota'); }, senders);
    expect(out.map((s) => s.verdict)).toEqual([null, null]);
  });
});
