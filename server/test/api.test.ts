import { describe, expect, it } from 'vitest';
import { createApp } from '../src/api.ts';
import { openArchive } from '../src/archive.ts';
import type { Config } from '../src/config.ts';
import type { GmailPort } from '../src/gmail.ts';
import { openStore } from '../src/store.ts';
import { fakeGmail } from './fakeGmail.ts';
import { mail } from './fixtures.ts';

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
  const archive = openArchive(store.db);
  const fetched: { url: string; init?: RequestInit }[] = [];
  const created: unknown[] = [];
  const saved: unknown[] = [];
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
      JSON.stringify(i.schema).includes('"body"')
        ? { subject: 'Petit retard', body: 'Coucou Sophie, j’aurai 10 minutes de retard. [Prénom]' }
        : JSON.stringify(i.schema).includes('gmailQuery')
        ? { gmailQuery: 'from:syndic AG', explanation: 'Mails du syndic sur l’AG', keywords: ['syndic', 'AG'] }
        : JSON.stringify(i.schema).includes('answer')
        ? { answer: 'L’AG a lieu le 3 décembre à 18h30.', relevantIds: ['n1'] }
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
    notifier: { notifyReplies: async () => {} },
    runCycle: async () => {},
    status: () => ({ running: false, error: null }),
    calendar: () => ({
      upcoming: async () => [{ title: 'Dentiste', start: '2026-11-14T10:00:00+01:00', end: '2026-11-14T11:00:00+01:00', allDay: false }],
      range: async (from: string, to: string) => [{ title: `Du ${from.slice(0, 10)} au ${to.slice(0, 10)}`, start: '2026-12-01', end: '2026-12-02', allDay: true }],
      create: async (e) => {
        created.push(e);
        return { link: 'https://calendar.google.com/event?eid=x' };
      },
    }),
    claudeInfo: async () => ({ installed: true, version: '2.1.322 (Claude Code)' }),
    claudeTest: async () => ({ ok: true, ms: 1200 }),
    fetchImpl: async (url, init) => {
      fetched.push({ url: String(url), init });
      return new Response('ok');
    },
  });
  return { app, store, g, fetched, created, archive, saved };
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

  it('returns 404 for an unknown mail', async () => {
    const { app } = setup();
    expect((await app.request('/api/mail/zzz/archive', { method: 'POST', headers: auth })).status).toBe(404);
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
    expect(created.at(-1)).toEqual({ title: 'Garage', start: '2026-11-20T09:00:00+01:00', end: '2026-11-20T10:00:00+01:00', location: 'Rennes' });
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
    expect(body.answer).toBe('L’AG a lieu le 3 décembre à 18h30.');
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(['n1', 'n3']);
    expect(body.results[0].relevant).toBe(true);
    expect(g.calls.find((c) => c.method === 'listInboxIds')?.args).toEqual(['from:syndic AG', 25]);
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

  it('lets Calme write a new mail from a short brief', async () => {
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
    expect(body.settings).toEqual({ autoUnsubscribe: false, keepSenders: [], archiveMonths: 12, language: 'fr', model: 'haiku', intervalMin: 5 });
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
