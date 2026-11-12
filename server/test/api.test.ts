import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/api.ts';
import { openArchive } from '../src/archive.ts';
import type { Config } from '../src/config.ts';
import type { GmailPort } from '../src/gmail.ts';
import { openStore } from '../src/store.ts';
import { fakeGmail } from './fakeGmail.ts';
import { mail } from './fixtures.ts';
import { part } from './mimeParts.ts';

const TOKEN = 'secret-token';
const cfg: Config = {
  home: '/tmp/none',
  port: 4747,
  model: 'haiku',
  intervalMin: 5,
  pairingToken: TOKEN,
  vapid: { publicKey: 'pub', privateKey: 'priv' },
};

function setup(gmailConnected = true) {
  const store = openStore(':memory:');
  store.upsertMessages([mail('a'), mail('b', { fromEmail: 'news@x.fr', unsub: { oneClickUrl: 'https://x.fr/u' } })]);
  store.saveAnalyses([
    { id: 'a', category: 'trash', summary: [], action: '', replies: [], group: 'Promotions' },
    { id: 'b', category: 'news', summary: [], action: '', replies: [], group: null },
  ]);
  const g = fakeGmail();
  const bkRoot = mkdtempSync(join(tmpdir(), 'calme-api-'));
  const archive = openArchive(store.db);
  const fetched: { url: string; init?: RequestInit }[] = [];
  const created: unknown[] = [];
  const saved: unknown[] = [];
  const asked: string[] = [];
  store.saveAnalyses([
    { id: 'a', category: 'trash', summary: [], action: '', replies: [], group: 'Promotions',
      event: { title: 'AG', start: '2026-12-03T18:30:00+01:00', end: '2026-12-03T20:00:00+01:00', location: null } },
  ]);
  const app = createApp({
    store,
    archive,
    gmail: () => (gmailConnected ? (g.port as GmailPort) : null),
    oauth: { hasCredentials: () => true, isConnected: () => gmailConnected, authUrl: () => 'https://accounts', exchange: async () => {}, saveCredentials: (raw: unknown) => saved.push(raw) },
    runner: async (i) =>
      JSON.stringify(i.schema).includes('"subject"') && !JSON.stringify(i.schema).includes('"body"')
        ? { subject: 'Retard samedi soir' }
        : JSON.stringify(i.schema).includes('"questions"')
        ? { questions: [{ question: 'À quelle heure arrives-tu ?', suggestions: ['19h', '20h', '20h30'] }, { question: '', suggestions: [] }] }
        : JSON.stringify(i.schema).includes('"body"')
        ? { subject: 'Petit retard', body: 'Coucou Sophie, j’aurai 10 minutes de retard. [Prénom]' }
        : JSON.stringify(i.schema).includes('gmailQuery')
        ? { gmailQuery: 'from:syndic AG', explanation: 'Mails du syndic sur l’AG', keywords: ['syndic', 'AG'] }
        : JSON.stringify(i.schema).includes('"remindAt"')
        ? { text: 'Regarder l’achat d’un compteur électrique de chantier', remindAt: '2099-11-14T09:00:00+01:00' }
        : JSON.stringify(i.schema).includes('"glance"')
        ? (asked.push('glance'), { glance: 'Semaine calme : **dentiste samedi**.', points: ['Samedi 10h — dentiste', '', 'Penser au compteur'] })
        : JSON.stringify(i.schema).includes('"sections"')
        ? { lead: 'L’AG a lieu le 3 décembre à 18h30.', sections: [], points: [], relevantIds: ['n1'] }
        : JSON.stringify(i.schema).includes('slots')
        ? {
            slots: [
              { start: '2026-11-14T10:30:00+01:00', end: '2026-11-14T11:30:00+01:00' },
              { start: '2030-01-10T14:00:00+01:00', end: '2030-01-10T15:00:00+01:00' },
              { start: '2020-01-10T14:00:00+01:00', end: '2020-01-10T15:00:00+01:00' },
            ],
            draft: 'Bonjour, je propose jeudi 10 janvier à 14h.',
          }
        : { draft: 'Nouveau brouillon' },
    cfg,
    notifier: { notifyReplies: async () => {}, notifyReminders: async () => {}, alerts: () => [], test: async () => true },
    runCycle: async () => {},
    status: () => ({ running: false, error: null }),
    calendar: () => ({
      calendars: async () => ({
        list: [
          { id: 'primary-id', name: 'moi@exemple.fr', color: '#039be5', primary: true, writable: true },
          { id: 'famille-id', name: 'Famille', color: '#f6bf26', primary: false, writable: true },
          { id: 'feries-id', name: 'Jours fériés en France', color: '#0b8043', primary: false, writable: false },
        ],
        limited: false,
      }),
      upcoming: async () => [{ title: 'Dentiste', start: '2026-11-14T10:00:00+01:00', end: '2026-11-14T11:00:00+01:00', allDay: false }],
      search: async () => [],
      range: async (from: string, to: string) => [{ title: `Du ${from.slice(0, 10)} au ${to.slice(0, 10)}`, start: '2026-12-01', end: '2026-12-02', allDay: true }],
      create: async (e) => {
        created.push(e);
        return { link: 'https://calendar.google.com/event?eid=x' };
      },
      remove: async (calendarId: string, eventId: string) => {
        created.push({ removed: { calendarId, eventId } });
      },
      update: async (calendarId: string, eventId: string, e: unknown) => {
        created.push({ updated: { calendarId, eventId, e } });
        return { link: 'https://calendar.google.com/event?eid=y' };
      },
    }),
    backup: { dir: join(bkRoot, 'backups'), dbPath: join(bkRoot, 'calme.db') },
    remote: { status: async () => ({ installed: true, serving: false, url: null }), enable: async () => ({ url: 'https://mac.tail.ts.net' }) },
    claudeInfo: async () => ({ installed: true, version: '2.1.322 (Claude Code)' }),
    claudeTest: async () => ({ ok: true, ms: 1200 }),
    fetchImpl: async (url, init) => {
      fetched.push({ url: String(url), init });
      if (String(url) === 'https://shop.fr/apple-touch-icon.png') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
      if (String(url).startsWith('https://data.geopf.fr/geocodage/search')) {
        if (String(url).includes('panne')) return new Response('{"message":"The upstream server is timing out"}', { status: 504 });
        return Response.json({
          type: 'FeatureCollection',
          features: [
            { geometry: { type: 'Point', coordinates: [2.3367, 48.8617] }, properties: { label: '10 Rue de Rivoli 75004 Paris', name: '10 Rue de Rivoli', postcode: '75004', city: 'Paris', context: '75, Paris, Île-de-France', type: 'housenumber', score: 0.9 } },
            { geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: { label: 'Rue de Rivoli 75001 Paris', name: 'Rue de Rivoli', postcode: '75001', city: 'Paris', context: '75, Paris, Île-de-France', type: 'street', score: 0.8 } },
          ],
        });
      }
      return new Response('ok');
    },
  });
  return { app, store, g, fetched, created, archive, saved, asked };
}

const auth = { Authorization: `Bearer ${TOKEN}` };

describe('api auth', () => {
  it('rejects requests without the pairing token', async () => {
    const { app } = setup();
    expect((await app.request('/api/state')).status).toBe(401);
    expect((await app.request('/api/state', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('serves state with the token', async () => {
    const { app } = setup();
    const res = await app.request('/api/state', { headers: auth });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gmail).toBe('connected');
    expect(body.language).toBe('fr');
    expect(body.emails).toHaveLength(2);
    expect(body.counts).toEqual({ reply: 0, read: 0, news: 1, trash: 1 });
  });

  it('keeps the state light: no mail bodies in the list, body served per mail', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/state', { headers: auth })).json();
    expect(body.emails[0].text).toBeUndefined();
    const one = await (await app.request('/api/mail/a', { headers: auth })).json();
    expect(one.text).toBe('corps du mail a');
    expect((await app.request('/api/mail/zzz', { headers: auth })).status).toBe(404);
  });

  it('reports a disconnected gmail', async () => {
    const { app } = setup(false);
    const body = await (await app.request('/api/state', { headers: auth })).json();
    expect(body.gmail).toBe('disconnected');
  });

  it('refuses the oauth callback from a proxied (remote) request', async () => {
    const { app } = setup();
    const res = await app.request('/oauth/callback?code=x&state=y', { headers: { 'x-forwarded-for': '100.64.0.2' } });
    expect(res.status).toBe(403);
  });
});

describe('api actions', () => {
  it('trashes a mail and drops it from the inbox', async () => {
    const { app, store, g } = setup();
    const res = await app.request('/api/mail/a/trash', { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    expect(g.calls.find((c) => c.method === 'trash')?.args).toEqual(['a']);
    expect(store.getMail('a')).toBeNull();
  });

  it('undoes a trash: untrashes in Gmail and brings the mail back to the inbox', async () => {
    const { app, store, g } = setup();
    await app.request('/api/mail/a/trash', { method: 'POST', headers: auth });
    const res = await app.request('/api/mail/a/untrash', { method: 'POST', headers: auth });
    expect(res.status).toBe(200);
    expect(g.calls.find((c) => c.method === 'untrash')?.args).toEqual(['a']);
    expect(store.getMail('a')?.id).toBe('a');
  });

  it('refuses to untrash a mail Calm never had', async () => {
    const { app, g } = setup();
    expect((await app.request('/api/mail/zzz/untrash', { method: 'POST', headers: auth })).status).toBe(404);
    expect(g.calls.some((c) => c.method === 'untrash')).toBe(false);
  });

  it('returns 404 for an unknown mail', async () => {
    const { app } = setup();
    expect((await app.request('/api/mail/zzz/archive', { method: 'POST', headers: auth })).status).toBe(404);
  });

  it('marks mails unread then read again, in Gmail and in Calm', async () => {
    const { app, g, store } = setup();
    const send = (body: unknown) => app.request('/api/mails/read', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send({ ids: ['a', 'b'], read: false })).status).toBe(200);
    expect(g.calls.filter((c) => c.method === 'modify').map((c) => c.args)).toEqual([['a', ['UNREAD'], []], ['b', ['UNREAD'], []]]);
    expect(store.getMail('b')?.labelIds).toContain('UNREAD');
    expect((await send({ ids: ['b'], read: true })).status).toBe(200);
    expect(g.calls.at(-1)?.args).toEqual(['b', [], ['UNREAD']]);
    expect(store.getMail('b')?.labelIds).not.toContain('UNREAD');
  });

  it('refuses a bad read request and an unknown mail', async () => {
    const { app } = setup();
    const send = (body: unknown) => app.request('/api/mails/read', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send({ ids: [], read: true })).status).toBe(400);
    expect((await send({ ids: ['a'], read: 'yes' })).status).toBe(400);
    expect((await send({ ids: [1], read: true })).status).toBe(400);
    expect((await send({ ids: ['zzz'], read: true })).status).toBe(404);
  });

  it('keeps reminders: from a mail, edited, done, deleted', async () => {
    const { app } = setup();
    const json = (method: string, path: string, body?: unknown) =>
      app.request(path, { method, headers: { ...auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const made = await (await json('POST', '/api/reminders', { text: '  Compteur de chantier ', due: 4102444800000, mailId: 'a', early: 1440 })).json();
    expect(made.early).toBe(1440);
    expect(made).toMatchObject({ text: 'Compteur de chantier', due: 4102444800000, mailId: 'a', mailSubject: 'Sujet a', mailFrom: 'Sophie Martin', done: false });
    expect((await json('PATCH', `/api/reminders/${made.id}`, { done: true })).status).toBe(200);
    expect((await (await json('GET', '/api/reminders')).json())[0]).toMatchObject({ id: made.id, done: true });
    expect((await json('DELETE', `/api/reminders/${made.id}`)).status).toBe(200);
    expect(await (await json('GET', '/api/reminders')).json()).toEqual([]);
  });

  it('refuses a reminder without text, with a bad date or an unknown mail', async () => {
    const { app } = setup();
    const send = (body: unknown) => app.request('/api/reminders', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send({ text: ' ' })).status).toBe(400);
    expect((await send({ text: 'x'.repeat(301) })).status).toBe(400);
    expect((await send({ text: 'ok', due: 'demain' })).status).toBe(400);
    expect((await send({ text: 'ok', due: 5, early: 30 })).status).toBe(400);
    expect((await send({ text: 'ok', mailId: 'zzz' })).status).toBe(404);
    expect((await app.request('/api/reminders/zzz', { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: '{"done":true}' })).status).toBe(404);
  });

  it('asks Calm what to remember from a mail, and when', async () => {
    const { app } = setup();
    const r = await (await app.request('/api/mail/a/reminder', { method: 'POST', headers: auth })).json();
    expect(r).toEqual({ text: 'Regarder l’achat d’un compteur électrique de chantier', due: Date.parse('2099-11-14T09:00:00+01:00') });
  });

  it('reads the agenda once, then serves it again until the agenda or reminders change', async () => {
    const { app, asked } = setup();
    const brief = async () => (await app.request('/api/agenda/brief', { method: 'POST', headers: auth })).json();
    expect(await brief()).toMatchObject({ glance: 'Semaine calme : **dentiste samedi**.', points: ['Samedi 10h — dentiste', 'Penser au compteur'] });
    await brief();
    expect(asked).toHaveLength(1);
    await app.request('/api/reminders', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Compteur', due: Date.now() + 86400_000 }) });
    await brief();
    expect(asked).toHaveLength(2);
  });

  it('gives the account shown in the menu: name and address', async () => {
    const { app } = setup();
    expect(await (await app.request('/api/account', { headers: auth })).json()).toEqual({ email: 'moi@x.fr', name: 'Camille Test' });
  });

  it('quick search: inbox and local base, contents included, accents ignored, newest first', async () => {
    const { app, archive } = setup();
    archive.add([mail('old1', { subject: 'Devis électricité', text: 'Le compteur de chantier', date: Date.parse('2026-01-05T09:00:00Z') })]);
    const q = async (s: string) => (await app.request(`/api/search/quick?q=${encodeURIComponent(s)}`, { headers: auth })).json();
    expect((await q('corps mail b')).map((r: { id: string }) => r.id)).toEqual(['b']);
    const r = await q('COMPTEUR electricite');
    expect(r).toEqual([expect.objectContaining({ id: 'old1', source: 'local', subject: 'Devis électricité' })]);
    expect(await q(' ')).toEqual([]);
  });

  it('gives the logos of the senders’ organisations, fetched once from their own site', async () => {
    const { app, fetched } = setup();
    const ask = async (domains: unknown) =>
      (await app.request('/api/logos', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ domains }) })).json();
    const r = await ask(['news.shop.fr', 'gmail.com', 'localhost', '192.168.1.2']);
    expect(r['news.shop.fr']).toBe('data:image/png;base64,iVBORw==');
    expect(r['gmail.com']).toBeNull();
    expect(r['localhost']).toBeNull();
    expect(r['192.168.1.2']).toBeNull();
    expect(fetched.every((f) => f.url.startsWith('https://shop.fr/'))).toBe(true);
    const before = fetched.length;
    await ask(['shop.fr']);
    expect(fetched.length).toBe(before);
  });

  it('creates a folder, and refuses an empty or duplicate name', async () => {
    const { app, g } = setup();
    const send = (name: unknown) => app.request('/api/labels', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    expect(await (await send('  Maison/Travaux ')).json()).toEqual({ id: 'Label_new', name: 'Maison/Travaux' });
    expect(g.calls.find((c) => c.method === 'createLabel')?.args).toEqual(['Maison/Travaux']);
    expect((await send(' ')).status).toBe(400);
    expect((await send('factures')).status).toBe(409);
  });

  it('deletes a folder after moving its mails, to another folder or back to the inbox', async () => {
    const { app, g } = setup();
    const del = (id: string, moveTo?: string) => app.request(`/api/labels/${id}${moveTo ? `?moveTo=${moveTo}` : ''}`, { method: 'DELETE', headers: auth });
    expect(await (await del('Label_1', 'Label_2')).json()).toEqual({ ok: true, moved: 2 });
    expect(g.calls.find((c) => c.method === 'batchModify')?.args).toEqual([['f1', 'f2'], ['Label_2'], ['Label_1']]);
    expect(g.calls.at(-1)).toEqual({ method: 'deleteLabel', args: ['Label_1'] });
    await del('Label_2', 'INBOX');
    expect(g.calls.filter((c) => c.method === 'batchModify').at(-1)?.args).toEqual([['f1', 'f2'], ['INBOX'], ['Label_2']]);
    const before = g.calls.filter((c) => c.method === 'batchModify').length;
    expect(await (await del('Label_1')).json()).toEqual({ ok: true, moved: 0 });
    expect(g.calls.filter((c) => c.method === 'batchModify').length).toBe(before);
    expect((await del('Label_1', 'Label_1')).status).toBe(400);
    expect((await del('Label_9')).status).toBe(404);
    expect((await del('Label_1', 'Label_9')).status).toBe(400);
  });

  it('moves several mails to a folder and trashes or restores them, found anywhere in Gmail', async () => {
    const { app, g, store } = setup();
    const send = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await send('/api/mails/move', { ids: ['a', 'old-gmail-id'], labelId: 'Label_2' })).status).toBe(200);
    expect(g.calls.find((c) => c.method === 'batchModify')?.args).toEqual([['a', 'old-gmail-id'], ['Label_2'], ['INBOX']]);
    expect(store.getMail('a')).toBeNull();
    expect((await send('/api/mails/move', { ids: ['b'], labelId: 'Label_9' })).status).toBe(400);
    expect((await send('/api/mails/trash', { ids: ['b', 'old-gmail-id'] })).status).toBe(200);
    expect(g.calls.filter((c) => c.method === 'trash').map((c) => c.args[0])).toEqual(['b', 'old-gmail-id']);
    expect(store.getMail('b')).toBeNull();
    expect((await send('/api/mails/untrash', { ids: ['b', 'old-gmail-id'] })).status).toBe(200);
    expect(store.getMail('b')).not.toBeNull();
    expect((await send('/api/mails/trash', { ids: [] })).status).toBe(400);
  });

  it('reports what Calm’s use of Claude costs', async () => {
    const { app } = setup();
    const r = await (await app.request('/api/ai-usage', { headers: auth })).json();
    expect(r.today).toEqual({ cost: 0, calls: 0 });
    expect(r.days).toHaveLength(30);
  });

  it('lists the trash (headers only), to bring mails back', async () => {
    const { app, g } = setup();
    const r = await (await app.request('/api/trash', { headers: auth })).json();
    expect(r.map((m: { id: string }) => m.id)).toEqual(['t1', 't2']);
    expect(g.calls.some((c) => c.method === 'get')).toBe(false);
  });

  it('files a mail in the folder the action names, creating it when missing', async () => {
    const { app, g, store } = setup();
    const file = (id: string, name: unknown) => app.request(`/api/mail/${id}/file`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    expect(await (await file('a', 'factures')).json()).toEqual({ ok: true, labelId: 'Label_1', name: 'Factures', created: false });
    expect(g.calls.find((c) => c.method === 'modify')?.args).toEqual(['a', ['Label_1'], ['INBOX']]);
    expect(g.calls.some((c) => c.method === 'createLabel')).toBe(false);
    expect(store.getMail('a')).toBeNull();
    expect(await (await file('b', ' Impôts 2026 ')).json()).toEqual({ ok: true, labelId: 'Label_new', name: 'Impôts 2026', created: true });
    expect(g.calls.find((c) => c.method === 'createLabel')?.args).toEqual(['Impôts 2026']);
    expect((await file('zzz', 'Factures')).status).toBe(404);
  });

  it('refuses to file under an empty name', async () => {
    const { app } = setup();
    expect((await app.request('/api/mail/a/file', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{"name":"  "}' })).status).toBe(400);
  });

  it('archives by removing the INBOX label', async () => {
    const { app, g } = setup();
    await app.request('/api/mail/a/archive', { method: 'POST', headers: auth });
    expect(g.calls.find((c) => c.method === 'modify')?.args).toEqual(['a', [], ['INBOX']]);
  });

  it('rejects attachments over 20 MB', async () => {
    const { app } = setup();
    const form = new FormData();
    form.set('to', 's@x.fr');
    form.set('subject', 'Re: x');
    form.set('body', 'ok');
    form.append('files', new File([new Uint8Array(21 * 1024 * 1024)], 'gros.bin'));
    const res = await app.request('/api/reply', { method: 'POST', headers: auth, body: form });
    expect(res.status).toBe(413);
  });

  it('sends a threaded reply with attachment and archives the original', async () => {
    const { app, g, store } = setup();
    const form = new FormData();
    form.set('mailId', 'a');
    form.set('to', 's@x.fr');
    form.set('subject', 'Re: Sujet a');
    form.set('body', 'Avec plaisir');
    form.append('files', new File(['%PDF'], 'récap.pdf', { type: 'application/pdf' }));
    const res = await app.request('/api/reply', { method: 'POST', headers: auth, body: form });
    expect(res.status).toBe(200);
    const send = g.calls.find((c) => c.method === 'send');
    expect(send?.args[1]).toBe('t-a');
    const raw = Buffer.from(send?.args[0] as string, 'base64url').toString();
    expect(raw).toContain('In-Reply-To: <a@exemple.fr>');
    expect(raw).toContain('From: moi@x.fr');
    expect(store.getMail('a')).toBeNull();
  });

  it('redrafts through claude', async () => {
    const { app } = setup();
    const res = await app.request('/api/redraft', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ mailId: 'a', draft: 'x', tone: 'short', instruction: 'plus court' }),
    });
    expect(await res.json()).toEqual({ draft: 'Nouveau brouillon' });
  });
});

describe('api calendar', () => {
  it('adds the proposed event to the calendar on request', async () => {
    const { app, created } = setup();
    const res = await app.request('/api/mail/a/event', { method: 'POST', headers: auth });
    expect(await res.json()).toEqual({ link: 'https://calendar.google.com/event?eid=x' });
    expect(created).toEqual([{ title: 'AG', start: '2026-12-03T18:30:00+01:00', end: '2026-12-03T20:00:00+01:00', location: null }]);
  });

  it('lists upcoming events and events proposed by mails', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/agenda', { headers: auth })).json();
    expect(body.events).toEqual([{ title: 'Dentiste', start: '2026-11-14T10:00:00+01:00', end: '2026-11-14T11:00:00+01:00', allDay: false }]);
    expect(body.proposals).toHaveLength(1);
    expect(body.proposals[0]).toMatchObject({
      mailId: 'a', fromName: 'Sophie Martin', subject: 'Sujet a', conflict: null, added: null,
      event: { title: 'AG', start: '2026-12-03T18:30:00+01:00', end: '2026-12-03T20:00:00+01:00', location: null },
    });
  });

  it('flags a proposal that overlaps an existing event', async () => {
    const { app, store } = setup();
    store.saveAnalyses([{ id: 'b', category: 'reply', summary: [], action: '', replies: [], group: null,
      event: { title: 'Banque', start: '2026-11-14T10:30:00+01:00', end: '2026-11-14T11:30:00+01:00', location: null } }]);
    const body = await (await app.request('/api/agenda', { headers: auth })).json();
    expect(body.proposals.find((p: { mailId: string }) => p.mailId === 'b').conflict).toBe('Dentiste');
  });

  it('hides a dismissed proposal and remembers an added one', async () => {
    const { app } = setup();
    await app.request('/api/mail/a/event', { method: 'POST', headers: auth });
    let body = await (await app.request('/api/agenda', { headers: auth })).json();
    expect(body.proposals[0].added).toBe('https://calendar.google.com/event?eid=x');
    await app.request('/api/agenda/dismiss/a', { method: 'POST', headers: auth });
    body = await (await app.request('/api/agenda', { headers: auth })).json();
    expect(body.proposals).toEqual([]);
  });

  it('creates an event by hand and validates dates', async () => {
    const { app, created } = setup();
    const post = (b: unknown) => app.request('/api/agenda/events', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const ok = await post({ title: 'Garage', start: '2026-11-20T09:00:00+01:00', end: '2026-11-20T10:00:00+01:00', location: 'Rennes' });
    expect(await ok.json()).toEqual({ link: 'https://calendar.google.com/event?eid=x' });
    expect(created.at(-1)).toEqual({ title: 'Garage', start: '2026-11-20T09:00:00+01:00', end: '2026-11-20T10:00:00+01:00', location: 'Rennes', allDay: false });
    expect((await post({ title: 'X', start: '2026-11-20T10:00:00+01:00', end: '2026-11-20T09:00:00+01:00' })).status).toBe(400);
    expect((await post({ title: '', start: '2026-11-20T09:00:00+01:00', end: '2026-11-20T10:00:00+01:00' })).status).toBe(400);
  });

  it('proposes free future slots from a mail, dropping conflicts and past ones', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/mail/a/slots', { method: 'POST', headers: auth })).json();
    expect(body.slots).toEqual([{ start: '2030-01-10T14:00:00+01:00', end: '2030-01-10T15:00:00+01:00' }]);
    expect(body.draft).toContain('14h');
  });

  it('returns 404 when the mail has no proposed event', async () => {
    const { app } = setup();
    expect((await app.request('/api/mail/b/event', { method: 'POST', headers: auth })).status).toBe(404);
  });
});

describe('api folders', () => {
  it('lists the mails of a Gmail label without bodies', async () => {
    const { app, g } = setup();
    const body = await (await app.request('/api/labels/Label_1/messages', { headers: auth })).json();
    expect(body.map((m: { subject: string }) => m.subject)).toEqual(['Édition 1', 'Édition 2']);
    expect(body[0].text).toBeUndefined();
    expect(g.calls.some((c) => c.method === 'get')).toBe(false);
    expect(g.calls.find((c) => c.method === 'listByLabel')?.args).toEqual(['Label_1', 50]);
  });

  it('reads one mail of a folder in full', async () => {
    const { app } = setup();
    const m = await (await app.request('/api/gmail/f1', { headers: auth })).json();
    expect(m.text).toBe('corps f1');
  });
});

describe('api newsletters', () => {
  it('scans newsletters and unsubscribes from a scanned sender', async () => {
    const { app, fetched } = setup();
    const list = await (await app.request('/api/newsletters/scan', { method: 'POST', headers: auth })).json();
    expect(Array.isArray(list.senders)).toBe(true);
    const res = await app.request('/api/newsletters/unsubscribe', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ senders: ['news@x.fr'] }),
    });
    expect(await res.json()).toEqual({ unsubscribed: 1, trashed: 0, toOpen: [] });
    expect(fetched.at(-1)?.url).toBe('https://x.fr/u');
    const after = await (await app.request('/api/newsletters', { headers: auth })).json();
    expect(after.unsubscribed).toEqual(['news@x.fr']);
  });
});

describe('api newsletters trash', () => {
  it('also trashes the scanned mails of unsubscribed senders when asked', async () => {
    const { app, g, store } = setup();
    store.setMeta('newsletters', JSON.stringify([{ fromEmail: 'gaz@x.fr', unsub: { oneClickUrl: 'https://gaz.fr/u' }, ids: ['g1', 'g2'] }]));
    const res = await app.request('/api/newsletters/unsubscribe', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ senders: ['gaz@x.fr'], trash: true }),
    });
    expect(await res.json()).toEqual({ unsubscribed: 1, trashed: 2, toOpen: [] });
    expect(g.calls.filter((c) => c.method === 'trash').map((c) => c.args[0])).toEqual(['g1', 'g2']);
  });
});

describe('api calendar range', () => {
  it('returns events for a date range', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/agenda/range?from=2026-12-01&to=2026-12-31', { headers: auth })).json();
    expect(body.events[0].title).toBe('Du 2026-12-01 au 2026-12-31');
  });

  it('rejects invalid or too long ranges', async () => {
    const { app } = setup();
    expect((await app.request('/api/agenda/range?from=2026-12-01&to=2027-06-01', { headers: auth })).status).toBe(400);
    expect((await app.request('/api/agenda/range?from=hier&to=demain', { headers: auth })).status).toBe(400);
  });
});

describe('api ai search', () => {
  it('turns a question into a Gmail search and answers from the results', async () => {
    const { app, g } = setup();
    g.state.ids = ['n1', 'n3'];
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Quand est l’AG du syndic ?' }),
    });
    const body = await res.json();
    expect(body.query).toBe('from:syndic AG');
    expect(body.lead).toBe('L’AG a lieu le 3 décembre à 18h30.');
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(['n1', 'n3']);
    expect(body.results[0].relevant).toBe(true);
    expect(g.calls.find((c) => c.method === 'listInboxIds')?.args).toEqual(['from:syndic AG', 30]);
    expect(Array.isArray(body.points)).toBe(true);
    expect(body.sections).toEqual([]);
  });

  it('covers a broad topic: always asks Gmail too, even when the local base already has many mails', async () => {
    const { app, archive, g } = setup();
    archive.add(Array.from({ length: 8 }, (_, i) => mail(`loc${i}`, { subject: `AG syndic ${i}`, fromEmail: 'gestion@syndic.fr', text: `Point ${i} sur l’AG du syndic.` })));
    g.state.ids = ['n1', 'n3'];
    const body = await (
      await app.request('/api/search', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Tout sur l’AG du syndic' }) })
    ).json();
    const ids = body.results.map((r: { id: string }) => r.id);
    expect(ids.filter((id: string) => id.startsWith('loc'))).toHaveLength(8);
    expect(ids).toEqual(expect.arrayContaining(['n1', 'n3']));
  });

  it('searches the local mail base first and reads full archived text', async () => {
    const { app, archive } = setup();
    archive.add([mail('arch1', { subject: 'Convocation AG', fromEmail: 'gestion@syndic.fr', text: 'L’assemblée du syndic aura lieu le 3 décembre.' })]);
    const body = await (
      await app.request('/api/search', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'AG syndic ?' }) })
    ).json();
    expect(body.results[0]).toMatchObject({ id: 'arch1', source: 'local' });
    const full = await (await app.request('/api/archive/arch1', { headers: auth })).json();
    expect(full.text).toContain('3 décembre');
  });

  it('requires a question', async () => {
    const { app } = setup();
    const res = await app.request('/api/search', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ question: ' ' }) });
    expect(res.status).toBe(400);
  });
});

describe('api contacts and compose', () => {
  it('suggests contacts from the local mail base', async () => {
    const { app, archive } = setup();
    archive.add([mail('c1', { fromName: 'Sophie Martin', fromEmail: 'sophie@x.fr' }), mail('c2', { fromName: 'Bob', fromEmail: 'bob@y.fr' })]);
    const list = await (await app.request('/api/contacts?q=soph', { headers: auth })).json();
    expect(list).toEqual([expect.objectContaining({ email: 'sophie@x.fr', name: 'Sophie Martin' })]);
  });

  it('lets Calm write a new mail from a short brief', async () => {
    const { app } = setup();
    const res = await app.request('/api/compose', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'sophie@x.fr', brief: 'dire que je serai en retard', tone: 'warm' }),
    });
    expect(await res.json()).toEqual({ subject: 'Petit retard', body: 'Coucou Sophie, j’aurai 10 minutes de retard. [Prénom]' });
    const bad = await app.request('/api/compose', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ brief: '' }) });
    expect(bad.status).toBe(400);
  });
});

describe('api setup', () => {
  it('reports what is left to configure and stays pending until completed', async () => {
    const { app } = setup();
    const s = await (await app.request('/api/setup', { headers: auth })).json();
    expect(s).toMatchObject({ claude: { installed: true }, credentials: true, gmail: true, done: false });
    expect((await (await app.request('/api/state', { headers: auth })).json()).setupDone).toBe(false);
    await app.request('/api/setup/complete', { method: 'POST', headers: auth });
    expect((await (await app.request('/api/state', { headers: auth })).json()).setupDone).toBe(true);
  });

  it('accepts a Google OAuth client file only from this computer, and only a valid one', async () => {
    const { app, saved } = setup();
    const valid = { installed: { client_id: 'x.apps.googleusercontent.com', client_secret: 'secret', redirect_uris: ['http://localhost'] } };
    const remote = await app.request('/api/setup/credentials', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', 'x-forwarded-for': '100.64.0.2' },
      body: JSON.stringify(valid),
    });
    expect(remote.status).toBe(403);
    expect(saved).toEqual([]);
  });

  it('rejects a file that is not a Google OAuth desktop client', async () => {
    const { app } = setup();
    const res = await app.request('/api/setup/credentials', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect([400, 403]).toContain(res.status);
  });
});

describe('api devices', () => {
  it('lists push devices with a readable name and removes one', async () => {
    const { app, store } = setup();
    store.addPushSub({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'k', auth: 'a' }, name: 'iPhone', addedAt: 1 });
    const list = await (await app.request('/api/push/devices', { headers: auth })).json();
    expect(list).toEqual([{ endpoint: 'https://web.push.apple.com/abc', name: 'iPhone', addedAt: 1 }]);
    await app.request('/api/push/devices/remove', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://web.push.apple.com/abc' }) });
    expect(await (await app.request('/api/push/devices', { headers: auth })).json()).toEqual([]);
  });
});

describe('api backup and remote', () => {
  it('backs up now and lists backups', async () => {
    const { app } = setup();
    const r = await (await app.request('/api/backup/now', { method: 'POST', headers: auth })).json();
    expect(r.name).toMatch(/^calme-\d{4}-\d{2}-\d{2}\.db$/);
    const list = await (await app.request('/api/backup', { headers: auth })).json();
    expect(list.backups.map((b: { name: string }) => b.name)).toEqual([r.name]);
  });

  it('refuses restore and Tailscale changes from another device', async () => {
    const { app } = setup();
    const remote = { ...auth, 'content-type': 'application/json', 'x-forwarded-for': '100.64.0.2' };
    expect((await app.request('/api/backup/restore', { method: 'POST', headers: remote, body: JSON.stringify({ name: 'calme-2026-11-12.db' }) })).status).toBe(403);
    expect((await app.request('/api/remote/enable', { method: 'POST', headers: remote })).status).toBe(403);
  });

  it('reports the iPhone link status', async () => {
    const { app } = setup();
    const r = await (await app.request('/api/remote', { headers: auth })).json();
    expect(r).toMatchObject({ installed: true, serving: false, url: null });
  });
});

describe('api quota', () => {
  it('exposes the Gmail quota gauge', async () => {
    const { app } = setup();
    const q = await (await app.request('/api/quota', { headers: auth })).json();
    expect(q).toMatchObject({ limit: 6000, budget: 5000 });
    expect(typeof q.used).toBe('number');
  });
});

describe('api admin', () => {
  it('reports Claude Code, Google and settings', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/admin', { headers: auth })).json();
    expect(body.claude).toEqual({ installed: true, version: '2.1.322 (Claude Code)' });
    expect(body.google.connected).toBe(true);
    expect(body.settings).toEqual({ autoUnsubscribe: false, keepSenders: [], archiveMonths: 12, language: 'fr', pushMode: 'reply', quietStart: null, quietEnd: null, remoteImages: true, signature: '', signatureOn: false, hiddenCalendars: [], model: 'haiku', intervalMin: 5 });
  });

  it('validates and saves settings', async () => {
    const { app } = setup();
    const put = (b: unknown) =>
      app.request('/api/admin/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    expect((await put({ model: 'gpt-4' })).status).toBe(400);
    expect((await put({ autoUnsubscribe: true, model: 'sonnet' })).status).toBe(200);
    const body = await (await app.request('/api/admin', { headers: auth })).json();
    expect(body.settings).toMatchObject({ autoUnsubscribe: true, model: 'sonnet' });
  });

  it('runs a Claude Code connectivity test', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/admin/claude-test', { method: 'POST', headers: auth })).json();
    expect(body).toEqual({ ok: true, ms: 1200 });
  });
});

describe('api cleanup', () => {
  it('groups trash and newsletters', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/cleanup', { headers: auth })).json();
    expect(body.groups).toEqual([{ group: 'Promotions', count: 1, ids: ['a'] }]);
    expect(body.newsletters[0]).toMatchObject({ fromEmail: 'news@x.fr', count: 1, canUnsub: true });
  });

  it('trashes only the given ids and unsubscribes with one-click POST', async () => {
    const { app, g, fetched } = setup();
    const res = await app.request('/api/cleanup', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ trashIds: ['a'], unsubscribe: ['news@x.fr'] }),
    });
    expect(await res.json()).toEqual({ trashed: 1, unsubscribed: 1, toOpen: [] });
    expect(g.calls.filter((c) => c.method === 'trash').map((c) => c.args[0])).toEqual(['a']);
    expect(fetched[0].url).toBe('https://x.fr/u');
    expect(fetched[0].init?.method).toBe('POST');
    expect(String(fetched[0].init?.body)).toBe('List-Unsubscribe=One-Click');
  });
});

describe('web app manifest', () => {
  const manifest = async (query = '') => {
    const { app } = setup();
    const res = await app.request(`/manifest.webmanifest${query}`);
    return { res, body: (await res.json()) as { start_url: string; name: string; display: string } };
  };

  it('is public and opens the inbox by default', async () => {
    const { res, body } = await manifest();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/manifest+json');
    expect(body).toMatchObject({ name: 'Calm', display: 'standalone', start_url: '/' });
  });

  it('carries the pairing into the home-screen app when the paired page asks with the right token', async () => {
    const { res, body } = await manifest(`?k=${TOKEN}`);
    expect(body.start_url).toBe(`/#pair=${TOKEN}`);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('never echoes a wrong token', async () => {
    expect((await manifest('?k=nope')).body.start_url).toBe('/');
    expect((await manifest(`?k=${TOKEN}x`)).body.start_url).toBe('/');
  });
});

describe('pairing a screen from afar (iPhone home-screen app)', () => {
  const LOCAL = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
  const iphone = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)', 'x-forwarded-for': '100.64.0.2' };
  const ask = async (app: ReturnType<typeof setup>['app']) => (await (await app.request('/pair/request', { method: 'POST', headers: iphone })).json()) as { id: string };
  const look = async (app: ReturnType<typeof setup>['app'], id: string) => (await app.request(`/pair/request/${id}`, { headers: iphone })).json();
  const decide = (app: ReturnType<typeof setup>['app'], id: string, approve: boolean, env: object | undefined = LOCAL, headers: Record<string, string> = {}) =>
    app.request(`/api/pair/requests/${id}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ approve }) }, env);

  it('lists the waiting request, named after the device, to paired screens only', async () => {
    const { app } = setup();
    const { id } = await ask(app);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect((await app.request('/api/pair/requests')).status).toBe(401);
    const list = await (await app.request('/api/pair/requests', { headers: auth })).json();
    expect(list).toEqual([expect.objectContaining({ id, name: 'iPhone' })]);
    expect(await look(app, id)).toEqual({ status: 'pending' });
  });

  it('hands the token once, after approval on the computer', async () => {
    const { app } = setup();
    const { id } = await ask(app);
    expect((await decide(app, id, true)).status).toBe(200);
    expect(await look(app, id)).toEqual({ status: 'approved', token: TOKEN });
    expect(await look(app, id)).toEqual({ status: 'expired' });
  });

  it('only the computer running Calm can approve', async () => {
    const { app } = setup();
    const { id } = await ask(app);
    expect((await decide(app, id, true, undefined, { 'x-forwarded-for': '100.64.0.2' })).status).toBe(403);
    expect(await look(app, id)).toEqual({ status: 'pending' });
  });

  it('tells the screen when the request is refused, without a token', async () => {
    const { app } = setup();
    const { id } = await ask(app);
    await decide(app, id, false);
    expect(await look(app, id)).toEqual({ status: 'denied' });
  });

  it('caps the waiting requests and knows nothing of unknown ids', async () => {
    const { app } = setup();
    for (let i = 0; i < 3; i++) await ask(app);
    expect((await app.request('/pair/request', { method: 'POST', headers: iphone })).status).toBe(429);
    expect(await look(app, 'f'.repeat(32))).toEqual({ status: 'expired' });
  });
});

describe('formatted mail (HTML)', () => {
  it('serves the stored HTML, cleaned, and keeps it out of the light views', async () => {
    const { app, store } = setup();
    store.upsertMessages([mail('h', { html: '<p>Bonjour</p><script>x()</script>' })]);
    const r = await (await app.request('/api/mail/h/html', { headers: auth })).json();
    expect(r.html).toBe('<p>Bonjour</p>');
    const state = await (await app.request('/api/state', { headers: auth })).json();
    expect(state.emails.find((m: { id: string }) => m.id === 'h')).not.toHaveProperty('html');
    expect(await (await app.request('/api/mail/h', { headers: auth })).json()).not.toHaveProperty('html');
  });

  it('fetches the HTML from Gmail once for a mail stored before, then keeps it', async () => {
    const { app, store, g } = setup();
    store.upsertMessages([mail('html1')]);
    const first = await (await app.request('/api/mail/html1/html', { headers: auth })).json();
    expect(first.html).toBe('<p>riche html1</p>');
    await app.request('/api/mail/html1/html', { headers: auth });
    expect(g.calls.filter((c) => c.method === 'get' && c.args[0] === 'html1')).toHaveLength(1);
  });

  it('answers null for a plain-text mail', async () => {
    const { app, store } = setup();
    store.upsertMessages([mail('plain1')]);
    expect(await (await app.request('/api/mail/plain1/html', { headers: auth })).json()).toEqual({ html: null });
  });
});

describe('remote images setting', () => {
  it('shows remote images by default and can block them; every screen learns it from the state', async () => {
    const { app } = setup();
    expect((await (await app.request('/api/state', { headers: auth })).json()).remoteImages).toBe(true);
    const put = await app.request('/api/admin/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ remoteImages: false }) });
    expect(put.status).toBe(200);
    expect((await (await app.request('/api/state', { headers: auth })).json()).remoteImages).toBe(false);
  });
});

describe('embedded images (signatures)', () => {
  it('puts the images a mail embeds right into its HTML, fetched once', async () => {
    const { app, store, g } = setup();
    store.upsertMessages([mail('cid1', { html: '<p>Bonjour</p><img src="cid:logo@x"><img src="cid:photo@x">' })]);
    const { html } = await (await app.request('/api/mail/cid1/html', { headers: auth })).json();
    expect(html).toContain(`src="data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}"`);
    expect(html).toContain(`src="data:image/jpeg;base64,${Buffer.from('JPGDATA').toString('base64')}"`);
    expect(html).not.toContain('cid:');
    await app.request('/api/mail/cid1/html', { headers: auth });
    expect(g.calls.filter((c) => c.method === 'get')).toHaveLength(1);
    expect(g.calls.filter((c) => c.method === 'attachment')).toHaveLength(1);
  });
});

describe('formatted mail from a Gmail folder', () => {
  it('never sends a folder mail’s raw HTML, and serves it cleaned with its embedded images', async () => {
    const { app } = setup();
    expect(await (await app.request('/api/gmail/html7', { headers: auth })).json()).not.toHaveProperty('html');
    expect((await (await app.request('/api/gmail/html7/html', { headers: auth })).json()).html).toBe('<p>riche html7</p>');
    const { html } = await (await app.request('/api/gmail/cid9/html', { headers: auth })).json();
    expect(html).toContain('data:image/png;base64,');
    expect(await (await app.request('/api/gmail/plain3/html', { headers: auth })).json()).toEqual({ html: null });
  });
});

describe('mark a mail as handled', () => {
  const put = (app: ReturnType<typeof setup>['app'], id: string, category: string) =>
    app.request(`/api/mail/${id}/category`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ category }) });

  it('moves a mail out of "to answer" and back (undo)', async () => {
    const { app, store } = setup();
    store.saveAnalyses([{ id: 'a', category: 'reply', summary: ['x'], action: 'répondre', replies: [], group: null }]);
    expect(store.counts().reply).toBe(1);
    expect((await put(app, 'a', 'read')).status).toBe(200);
    expect(store.counts().reply).toBe(0);
    expect(store.getMail('a')?.analysis?.category).toBe('read');
    expect(store.getMail('a')?.analysis?.summary).toEqual(['x']);
    await put(app, 'a', 'reply');
    expect(store.counts().reply).toBe(1);
  });

  it('refuses an unknown category or mail', async () => {
    const { app } = setup();
    expect((await put(app, 'a', 'spam')).status).toBe(400);
    expect((await put(app, 'zzz', 'read')).status).toBe(404);
  });
});

describe('address search (Géoplateforme)', () => {
  it('suggests French addresses as you type', async () => {
    const { app, fetched } = setup();
    const r = await (await app.request('/api/address?q=10%20rue%20de%20rivoli', { headers: auth })).json();
    expect(r[0]).toEqual({ label: '10 Rue de Rivoli 75004 Paris', name: '10 Rue de Rivoli', postcode: '75004', city: 'Paris', context: '75, Paris, Île-de-France', lat: 48.8617, lon: 2.3367 });
    expect(r).toHaveLength(2);
    const url = new URL(fetched.at(-1)!.url);
    expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search');
    expect(url.searchParams.get('q')).toBe('10 rue de rivoli');
    expect(url.searchParams.get('autocomplete')).toBe('1');
  });

  it('asks nothing for less than 3 characters', async () => {
    const { app, fetched } = setup();
    expect(await (await app.request('/api/address?q=ri', { headers: auth })).json()).toEqual([]);
    expect(fetched.some((f) => f.url.includes('geopf'))).toBe(false);
  });

  it('says so when the service is down, so the address can be typed by hand', async () => {
    const { app } = setup();
    expect((await app.request('/api/address?q=rue%20en%20panne', { headers: auth })).status).toBe(502);
  });
});

describe('full appointment form', () => {
  const post = (app: ReturnType<typeof setup>['app'], b: unknown) =>
    app.request('/api/agenda/events', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });

  it('creates an appointment with notes and a reminder', async () => {
    const { app, created } = setup();
    const ok = await post(app, { title: 'Notaire', start: '2026-11-20T18:00:00+01:00', end: '2026-11-20T19:00:00+01:00', location: '10 Rue de Rivoli 75004 Paris', description: 'Apporter le permis', reminderMin: 30 });
    expect(ok.status).toBe(200);
    expect(created.at(-1)).toEqual({ title: 'Notaire', start: '2026-11-20T18:00:00+01:00', end: '2026-11-20T19:00:00+01:00', location: '10 Rue de Rivoli 75004 Paris', description: 'Apporter le permis', reminderMin: 30, allDay: false });
  });

  it('creates an all-day appointment over several days (end day excluded)', async () => {
    const { app, created } = setup();
    expect((await post(app, { title: 'Vacances en Corse', allDay: true, start: '2026-12-21', end: '2026-12-28' })).status).toBe(200);
    expect(created.at(-1)).toMatchObject({ title: 'Vacances en Corse', allDay: true, start: '2026-12-21', end: '2026-12-28' });
    expect((await post(app, { title: 'X', allDay: true, start: '2026-12-21', end: '2026-12-21' })).status).toBe(400);
  });

  it('refuses a reminder that is not one of the offered ones', async () => {
    const { app } = setup();
    expect((await post(app, { title: 'X', start: '2026-11-20T18:00:00+01:00', end: '2026-11-20T19:00:00+01:00', reminderMin: 7 })).status).toBe(400);
  });
});

describe('several calendars', () => {
  it('lists the calendars with the agenda, and says when Google limits Calm to the main one', async () => {
    const { app } = setup();
    const body = await (await app.request('/api/agenda', { headers: auth })).json();
    expect(body.calendars.map((c: { name: string }) => c.name)).toEqual(['moi@exemple.fr', 'Famille', 'Jours fériés en France']);
    expect(body.limitedCalendars).toBe(false);
  });

  it('adds an appointment to the chosen calendar, only one Calm may write to', async () => {
    const { app, created } = setup();
    const post = (b: unknown) => app.request('/api/agenda/events', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const base = { title: 'Repas', start: '2026-11-22T12:00:00+01:00', end: '2026-11-22T14:00:00+01:00' };
    expect((await post({ ...base, calendarId: 'famille-id' })).status).toBe(200);
    expect(created.at(-1)).toMatchObject({ calendarId: 'famille-id' });
    expect((await post({ ...base, calendarId: 'feries-id' })).status).toBe(400);
    expect((await post({ ...base, calendarId: 'inconnu' })).status).toBe(400);
  });
});

describe('delete an appointment', () => {
  const del = (app: ReturnType<typeof setup>['app'], cal: string, id: string) =>
    app.request(`/api/agenda/events/${encodeURIComponent(cal)}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth });

  it('deletes it from its calendar', async () => {
    const { app, created } = setup();
    expect((await del(app, 'famille-id', 'ev123')).status).toBe(200);
    expect(created.at(-1)).toEqual({ removed: { calendarId: 'famille-id', eventId: 'ev123' } });
  });

  it('refuses a calendar Calm may not write to, or does not know', async () => {
    const { app, created } = setup();
    expect((await del(app, 'feries-id', 'ev1')).status).toBe(400);
    expect((await del(app, 'inconnu', 'ev1')).status).toBe(400);
    expect(created.some((c) => 'removed' in (c as object))).toBe(false);
  });
});

describe('email signature', () => {
  const save = (app: ReturnType<typeof setup>['app'], b: unknown) =>
    app.request('/api/admin/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const send = (app: ReturnType<typeof setup>['app'], body: string) => {
    const form = new FormData();
    form.set('to', 's@x.fr');
    form.set('subject', 'Bonjour');
    form.set('body', body);
    return app.request('/api/reply', { method: 'POST', headers: auth, body: form });
  };
  const sentRaw = (g: ReturnType<typeof setup>['g']) => Buffer.from(g.calls.filter((c) => c.method === 'send').at(-1)?.args[0] as string, 'base64url').toString();

  it('adds the signature in place of the [Prénom] placeholder when it is on', async () => {
    const { app, g } = setup();
    expect((await save(app, { signature: 'Damien\n**Calm.** · https://calm.example', signatureOn: true })).status).toBe(200);
    expect((await send(app, 'Avec plaisir !\n\nÀ bientôt,\n[Prénom]')).status).toBe(200);
    const raw = sentRaw(g);
    expect(part(raw, 'text/plain')).toBe('Avec plaisir !\n\nÀ bientôt,\n\n-- \nDamien\nCalm. · https://calm.example');
    expect(part(raw, 'text/html')).toContain('<strong>Calm.</strong>');
  });

  it('leaves the message alone when the signature is off', async () => {
    const { app, g } = setup();
    await save(app, { signature: 'Damien', signatureOn: false });
    await send(app, 'Merci\n[Prénom]');
    expect(part(sentRaw(g), 'text/plain')).toBe('Merci\n[Prénom]');
  });

  it('imports the Gmail signature as it is, in HTML', async () => {
    const { app } = setup();
    const r = await (await app.request('/api/signature/gmail', { headers: auth })).json();
    expect(r.html).toBe('<div dir="ltr">Damien Guesdon<br><b>Calm.</b></div>');
  });

  it('sends an HTML signature as HTML (cleaned) and as text', async () => {
    const { app, g } = setup();
    const sig = '<table><tr><td><b>Damien Guesdon</b><br><a href="https://calm.example">calm.example</a><img src="https://calm.example/logo.png" width="80"></td></tr></table><script>steal()</script>';
    expect((await save(app, { signature: sig, signatureOn: true })).status).toBe(200);
    await send(app, 'Merci !\n[Prénom]');
    const raw = sentRaw(g);
    const html = part(raw, 'text/html');
    expect(html).toContain('<img src="https://calm.example/logo.png" width="80">');
    expect(html).toContain('<a href="https://calm.example">calm.example</a>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('**');
    expect(part(raw, 'text/plain')).toContain('Merci !\n\n-- \nDamien Guesdon');
  });
});

describe('questions to refine a reply', () => {
  const ask = (app: ReturnType<typeof setup>['app'], b: unknown) =>
    app.request('/api/reply/questions', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });

  it('asks what the draft leaves unknown, with suggested answers', async () => {
    const { app } = setup();
    const r = await (await ask(app, { mailId: 'a', draft: 'Avec plaisir, j’arrive vers [heure].' })).json();
    expect(r.questions).toEqual([{ question: 'À quelle heure arrives-tu ?', suggestions: ['19h', '20h', '20h30'] }]);
  });

  it('needs a draft and a known mail', async () => {
    const { app } = setup();
    expect((await ask(app, { mailId: 'a', draft: '  ' })).status).toBe(400);
    expect((await ask(app, { mailId: 'zzz', draft: 'x' })).status).toBe(404);
  });
});

describe('subject suggestion', () => {
  const ask = (app: ReturnType<typeof setup>['app'], b: unknown) =>
    app.request('/api/subject', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });

  it('suggests a subject from the message', async () => {
    const { app } = setup();
    expect(await (await ask(app, { body: 'Coucou Sophie, j’aurai 10 minutes de retard samedi soir.' })).json()).toEqual({ subject: 'Retard samedi soir' });
  });

  it('needs some text', async () => {
    const { app } = setup();
    expect((await ask(app, { body: ' ' })).status).toBe(400);
  });
});

describe('edit an appointment', () => {
  const patch = (app: ReturnType<typeof setup>['app'], cal: string, id: string, b: unknown) =>
    app.request(`/api/agenda/events/${encodeURIComponent(cal)}/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(b) });

  it('saves the changes on the same appointment', async () => {
    const { app, created } = setup();
    const res = await patch(app, 'famille-id', 'ev9', { title: 'Repas de famille', start: '2026-11-22T12:30:00+01:00', end: '2026-11-22T15:00:00+01:00', location: 'Vitré', description: 'Apporter le gâteau' });
    expect(res.status).toBe(200);
    expect(created.at(-1)).toEqual({
      updated: { calendarId: 'famille-id', eventId: 'ev9', e: { title: 'Repas de famille', start: '2026-11-22T12:30:00+01:00', end: '2026-11-22T15:00:00+01:00', location: 'Vitré', allDay: false, description: 'Apporter le gâteau' } },
    });
  });

  it('checks the same things as a new appointment, and only in calendars Calm may write to', async () => {
    const { app } = setup();
    expect((await patch(app, 'famille-id', 'ev9', { title: 'X', start: '2026-11-22T15:00:00+01:00', end: '2026-11-22T12:00:00+01:00' })).status).toBe(400);
    expect((await patch(app, 'feries-id', 'ev9', { title: 'X', start: '2026-11-22T12:00:00+01:00', end: '2026-11-22T13:00:00+01:00' })).status).toBe(400);
  });
});

describe('calendars shown', () => {
  it('remembers the calendars to hide, for every device, and says which ones are hidden', async () => {
    const { app } = setup();
    const put = await app.request('/api/admin/settings', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ hiddenCalendars: ['feries-id', 'feries-id', 7] }) });
    expect(put.status).toBe(200);
    const body = await (await app.request('/api/agenda', { headers: auth })).json();
    expect(body.calendars.map((c: { id: string; hidden: boolean }) => [c.id, c.hidden])).toEqual([['primary-id', false], ['famille-id', false], ['feries-id', true]]);
  });
});
