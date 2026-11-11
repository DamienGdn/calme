import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { archive, cleanupView, label, MAX_ATTACHMENTS_BYTES, NotFound, sendReply, trash, unsubscribe, untrash } from './actions.ts';
import { conflictWith, formatAgenda, ISO_DATETIME, localIso, type CalendarPort } from './calendar.ts';
import type { ClaudeRunner } from './claude.ts';
import type { Config } from './config.ts';
import { GmailDisconnected, type GmailPort } from './gmail.ts';
import type { Notifier } from './notify.ts';
import type { Store } from './store.ts';
import { safeMailHtml } from './mailHtml.ts';
import { decodeEntities, inlineImages, parseAddress, parseGmailMessage } from './mime.ts';
import { adviseNewsletters, scanNewsletters, unsubscribedSenders } from './newsletters.ts';
import { getSettings, saveSettings } from './settings.ts';
import { quotaUsage, SCOPES, validateCredentials } from './gmail.ts';
import { proposeSlots, redraft, type Tone } from './triage.ts';
import { searchMail } from './search.ts';
import { backupNow, listBackups, pruneBackups, stageRestore } from './backup.ts';
import type { Archive } from './archive.ts';
import { composeMail } from './triage.ts';
import type { PushSub } from './types.ts';

export interface Deps {
  store: Store;
  archive?: Archive;
  gmail: () => GmailPort | null;
  oauth: {
    hasCredentials(): boolean;
    isConnected(): boolean;
    authUrl(redirect: string): string;
    exchange(code: string, redirect: string): Promise<void>;
    saveCredentials?(raw: unknown): void;
  };
  runner: ClaudeRunner;
  cfg: Config;
  notifier: Notifier;
  runCycle(): Promise<void>;
  status(): { running: boolean; error: string | null };
  calendar?: () => CalendarPort | null;
  backup?: { dir: string; dbPath: string };
  remote?: {
    status(): Promise<{ installed: boolean; serving: boolean; url: string | null }>;
    enable(): Promise<{ url: string | null; consentUrl?: string | null }>;
  };
  claudeInfo?: () => Promise<{ installed: boolean; version: string | null }>;
  claudeTest?: () => Promise<{ ok: boolean; ms: number; error?: string }>;
  fetchImpl?: typeof fetch;
  /** Restart the server (the desktop app relaunches it); used after staging a restore. */
  restart?: () => void;
}

const MANIFEST = {
  name: 'Calme',
  short_name: 'Calme',
  description: 'Your Gmail, sorted by Calme.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0D0E11',
  theme_color: '#0D0E11',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const MAX_EMBEDDED = 3_000_000;

/** Replaces cid: references with the embedded images (data: URLs); unknown or too large ones are dropped. */
async function embedImages(g: GmailPort, id: string, html: string, msg: Awaited<ReturnType<GmailPort['get']>>): Promise<string> {
  let out = html;
  for (const img of inlineImages(msg)) {
    if (!out.toLowerCase().includes(`cid:${img.cid.toLowerCase()}`)) continue;
    const b64url = img.data ?? (img.attachmentId ? await g.attachment(id, img.attachmentId) : '');
    const b64 = Buffer.from(b64url, 'base64url').toString('base64');
    const url = b64 && b64.length <= MAX_EMBEDDED && /^image\/[\w.+-]+$/.test(img.mimeType) ? `data:${img.mimeType};base64,${b64}` : '';
    out = out.replace(new RegExp(`cid:${img.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'), url);
  }
  return out.replace(/\bcid:[^"'\s>)]+/gi, '');
}

/** A plain device name from the browser's user agent (never trusted for anything but display). */
function deviceName(ua = ''): string {
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Navigateur';
}

/** True only for a direct request from this machine (not one relayed by tailscale serve or another proxy). */
function isLocalRequest(c: Context): boolean {
  if (c.req.header('x-forwarded-for') || c.req.header('forwarded') || c.req.header('tailscale-user-login')) return false;
  const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export function createApp(d: Deps) {
  const app = new Hono();
  const { store } = d;
  const redirect = () => `http://127.0.0.1:${d.cfg.port}/oauth/callback`;
  const oauthStates = new Set<string>();
  let me: string | null = null;

  const gmail = (): GmailPort => {
    const g = d.gmail();
    if (!g) throw new GmailDisconnected();
    return g;
  };
  const myEmail = async () => (me ??= await gmail().profileEmail());

  app.onError((e, c) => {
    if (e instanceof HTTPException) return e.getResponse();
    if (e instanceof NotFound) return c.json({ error: e.message }, 404);
    if (e instanceof GmailDisconnected) return c.json({ error: e.message, gmail: 'disconnected' }, 409);
    console.error('[api]', e);
    return c.json({ error: (e as Error).message }, 500);
  });

  // --- Google OAuth (only from the PC itself) ---
  // Web app manifest. On iPhone the home-screen app does not share Safari's storage, so a paired page asks for
  // ?k=<token> and the home-screen app starts at /#pair=<token>, pairing itself on first launch. A wrong token
  // is never echoed.
  app.get('/manifest.webmanifest', (c) => {
    const k = c.req.query('k');
    const paired = k !== undefined && sameSecret(k, d.cfg.pairingToken);
    c.header('Cache-Control', 'no-store');
    return c.body(
      JSON.stringify({
        ...MANIFEST,
        start_url: paired ? `/#pair=${encodeURIComponent(k)}` : '/',
      }),
      200,
      { 'Content-Type': 'application/manifest+json' },
    );
  });

  app.get('/auth/google', (c) => {
    if (!isLocalRequest(c)) return c.text('Connexion Gmail possible uniquement depuis le PC qui fait tourner Calme.', 403);
    const state = randomBytes(16).toString('hex');
    oauthStates.add(state);
    const url = new URL(d.oauth.authUrl(redirect()));
    url.searchParams.set('state', state);
    return c.redirect(url.toString());
  });

  app.get('/oauth/callback', async (c) => {
    if (!isLocalRequest(c)) return c.text('Interdit', 403);
    const { code, state } = c.req.query();
    if (!code || !state || !oauthStates.delete(state)) return c.text('Requête OAuth invalide', 400);
    await d.oauth.exchange(code, redirect());
    me = null;
    d.runCycle().catch(() => {});
    const en = getSettings(store, defaults()).language === 'en';
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calme</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0E11;color:#EDEBE5;font:16px system-ui">
<div style="max-width:460px;padding:24px;text-align:center">
<div style="width:72px;height:72px;margin:0 auto 20px;border-radius:18px;background:#C8F03C;color:#0D0E11;display:grid;place-items:center;font:italic 44px Georgia,serif">c.</div>
<h1 style="font:italic 400 40px Georgia,serif;margin:0 0 12px">${en ? 'Gmail is connected.' : 'Gmail est connecté.'}</h1>
<p style="color:#9C9BA3;line-height:1.6">${en ? 'You can close this tab and go back to Calme: it continues on its own.' : 'Tu peux fermer cet onglet et revenir dans Calme : il continue tout seul.'}</p>
<p><a href="/" style="color:#C8F03C">${en ? 'Open Calme here' : 'Ouvrir Calme ici'}</a></p></div>
<script>setTimeout(function(){window.close()},2500)</script></body>`);
  });

  // --- Pairing token on every API route ---
  // Pairing a screen from afar: the iPhone home-screen app has its own storage, so the QR code (which pairs Safari)
  // cannot reach it. The screen asks; the user approves on the computer running Calme; the screen picks up the token
  // once. Requests live 5 minutes, at most 3 wait at a time, and their 128-bit id is the screen's only handle.
  type PairRequest = { id: string; name: string; at: number; status: 'pending' | 'approved' | 'denied' };
  const pairRequests = new Map<string, PairRequest>();
  const PAIR_TTL = 5 * 60_000;
  const livePairs = () => {
    for (const [id, r] of pairRequests) if (Date.now() - r.at > PAIR_TTL) pairRequests.delete(id);
    return [...pairRequests.values()];
  };
  app.post('/pair/request', (c) => {
    if (livePairs().filter((r) => r.status === 'pending').length >= 3) return c.json({ error: 'Too many requests' }, 429);
    const r: PairRequest = { id: randomBytes(16).toString('hex'), name: deviceName(c.req.header('user-agent')), at: Date.now(), status: 'pending' };
    pairRequests.set(r.id, r);
    return c.json({ id: r.id });
  });
  app.get('/pair/request/:id', (c) => {
    livePairs();
    const r = pairRequests.get(c.req.param('id'));
    if (!r) return c.json({ status: 'expired' });
    if (r.status === 'pending') return c.json({ status: 'pending' });
    pairRequests.delete(r.id);
    return c.json(r.status === 'approved' ? { status: 'approved', token: d.cfg.pairingToken } : { status: 'denied' });
  });

  app.use('/api/*', async (c, next) => {
    const h = c.req.header('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token || !sameSecret(token, d.cfg.pairingToken)) return c.json({ error: 'Jeton d’appairage invalide' }, 401);
    await next();
  });

  app.get('/api/pair/requests', (c) => c.json(livePairs().filter((r) => r.status === 'pending').map(({ id, name, at }) => ({ id, name, at }))));
  app.post('/api/pair/requests/:id', async (c) => {
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calme' }, 403);
    const { approve } = await c.req.json<{ approve?: unknown }>();
    livePairs();
    const r = pairRequests.get(c.req.param('id'));
    if (!r || r.status !== 'pending') return c.json({ error: 'Request expired' }, 404);
    r.status = approve === true ? 'approved' : 'denied';
    return c.json({ ok: true });
  });

  app.get('/api/state', (c) => {
    const st = d.status();
    return c.json({
      gmail: !d.oauth.hasCredentials() ? 'no-credentials' : d.oauth.isConnected() && d.gmail() ? 'connected' : 'disconnected',
      counts: store.counts(),
      emails: store.listInbox().map(({ text: _text, html: _html, ...light }) => light),
      lastSync: Number(store.getMeta('lastSync') ?? 0) || null,
      analyzing: store.countUnanalyzed(),
      language: getSettings(store, defaults()).language,
      remoteImages: getSettings(store, defaults()).remoteImages,
      setupDone: store.getMeta('setupDone') === '1',
      running: st.running,
      error: st.error,
    });
  });

  app.get('/api/quota', (c) => c.json(quotaUsage()));

  // --- First-run setup wizard ---
  app.get('/api/setup', async (c) => {
    const connected = Boolean(d.oauth.hasCredentials() && d.oauth.isConnected() && d.gmail());
    return c.json({
      claude: d.claudeInfo ? await d.claudeInfo() : { installed: false, version: null },
      credentials: d.oauth.hasCredentials(),
      gmail: connected,
      account: connected ? await myEmail().catch(() => null) : null,
      local: isLocalRequest(c),
      settings: getSettings(store, defaults()),
      done: store.getMeta('setupDone') === '1',
    });
  });

  // The Google client secret is only accepted from this computer (like the Google sign-in itself).
  app.post('/api/setup/credentials', async (c) => {
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calme' }, 403);
    const raw = await c.req.json().catch(() => null);
    if (!validateCredentials(raw)) return c.json({ error: 'This is not a Google OAuth client file (type “Desktop app”).' }, 400);
    d.oauth.saveCredentials?.(raw);
    return c.json({ ok: true });
  });

  app.post('/api/setup/complete', (c) => {
    store.setMeta('setupDone', '1');
    return c.json({ ok: true });
  });

  app.get('/api/contacts', async (c) => {
    const me = d.gmail() ? await myEmail().catch(() => '') : '';
    return c.json(d.archive?.contacts(c.req.query('q') ?? '', Math.min(20, Number(c.req.query('limit') ?? 8)), me) ?? []);
  });

  app.get('/api/archive/:id', (c) => {
    const m = d.archive?.get(c.req.param('id'));
    return m ? c.json(m) : c.json({ error: 'Mail absent de la base locale' }, 404);
  });

  app.post('/api/compose', async (c) => {
    const b = await c.req.json<{ to?: string; brief?: string; tone?: Tone }>();
    if (!b.brief?.trim()) return c.json({ error: 'Dis à Calme ce que tu veux écrire' }, 400);
    const firstTo = (b.to ?? '').split(',')[0]?.replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase();
    const history = firstTo ? (d.archive?.withContact(firstTo, 5) ?? []) : [];
    return c.json(await composeMail(d.runner, { to: b.to ?? '', brief: b.brief.slice(0, 2000), tone: b.tone ?? 'neutral', history }));
  });

  app.get('/api/labels', async (c) => c.json(await gmail().listLabels()));

  // Gmail folders (labels): browsed live from Gmail, read-only, never triaged.
  app.get('/api/labels/:id/messages', async (c) => {
    const g = gmail();
    // Headers only (20 quota units each instead of 60): the body is fetched when a mail is opened.
    const ids = await g.listByLabel(c.req.param('id'), 50);
    const items = await Promise.all(
      ids.map(async (id) => {
        const h = await g.getHeaders(id);
        const from = parseAddress(h.From ?? '');
        return {
          id,
          fromName: from.name,
          fromEmail: from.email,
          subject: h.Subject ?? '',
          snippet: decodeEntities(h.__snippet ?? ''),
          date: Number(h.__date) || Date.parse(h.Date ?? '') || 0,
          attachmentNames: [],
          unsub: null,
        };
      }),
    );
    return c.json(items);
  });

  app.get('/api/gmail/:id', async (c) => c.json(parseGmailMessage(await gmail().get(c.req.param('id')))));

  app.get('/api/mail/:id', (c) => {
    const m = store.getMail(c.req.param('id'));
    if (!m) return c.json({ error: 'Mail introuvable' }, 404);
    const { html: _html, ...rest } = m;
    return c.json(rest);
  });

  // The mail's formatted version, cleaned (mailHtml.ts). Mails stored before Calme kept HTML get it from Gmail once.
  app.get('/api/mail/:id/html', async (c) => {
    const id = c.req.param('id');
    const m = store.getMail(id);
    if (!m) return c.json({ error: 'Mail introuvable' }, 404);
    let html = m.html;
    const g = d.gmail();
    let full: Awaited<ReturnType<GmailPort['get']>> | null = null;
    if (html === undefined && g) {
      full = await g.get(id);
      html = parseGmailMessage(full).html ?? '';
      store.setHtml(id, html);
    }
    // Embedded images (cid:…) go right into the HTML as data: URLs, once.
    if (html && g && /\bcid:/i.test(html)) {
      html = await embedImages(g, id, html, full ?? (await g.get(id)));
      store.setHtml(id, html);
    }
    return c.json({ html: html ? safeMailHtml(html) : null });
  });

  app.post('/api/sync', async (c) => {
    d.runCycle().catch(() => {});
    return c.json({ ok: true });
  });

  app.post('/api/mail/:id/archive', async (c) => {
    await archive(gmail(), store, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/mail/:id/trash', async (c) => {
    await trash(gmail(), store, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/mail/:id/untrash', async (c) => {
    await untrash(gmail(), store, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/mail/:id/label', async (c) => {
    const { labelId } = await c.req.json<{ labelId?: string }>();
    if (!labelId) return c.json({ error: 'labelId manquant' }, 400);
    await label(gmail(), store, c.req.param('id'), labelId);
    return c.json({ ok: true });
  });

  app.post(
    '/api/reply',
    bodyLimit({ maxSize: MAX_ATTACHMENTS_BYTES + 5 * 1024 * 1024, onError: (c) => c.json({ error: 'Pièces jointes trop lourdes (20 Mo max)' }, 413) }),
    async (c) => {
      const form = await c.req.parseBody({ all: true });
      const files = ([] as unknown[]).concat(form['files'] ?? []).filter((f): f is File => f instanceof File);
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > MAX_ATTACHMENTS_BYTES) return c.json({ error: 'Pièces jointes trop lourdes (20 Mo max)' }, 413);
      const field = (k: string) => (typeof form[k] === 'string' ? (form[k] as string) : '');
      if (!field('to').trim()) return c.json({ error: 'Destinataire manquant' }, 400);
      await sendReply(
        gmail(),
        store,
        {
          mailId: field('mailId') || undefined,
          to: field('to'),
          cc: field('cc'),
          subject: field('subject'),
          body: field('body'),
          attachments: await Promise.all(
            files.map(async (f) => ({ filename: f.name, mimeType: f.type || 'application/octet-stream', data: Buffer.from(await f.arrayBuffer()) })),
          ),
        },
        await myEmail(),
      );
      return c.json({ ok: true });
    },
  );

  app.post('/api/redraft', async (c) => {
    const b = await c.req.json<{ mailId: string; draft: string; tone: Tone; instruction?: string }>();
    const mail = store.getMail(b.mailId);
    if (!mail) return c.json({ error: 'Mail introuvable' }, 404);
    return c.json({ draft: await redraft(d.runner, { mail, draft: b.draft ?? '', tone: b.tone, instruction: b.instruction }) });
  });

  const metaJson = <T,>(key: string, fallback: T): T => JSON.parse(store.getMeta(key) ?? JSON.stringify(fallback));

  app.get('/api/agenda', async (c) => {
    const cal = d.calendar?.();
    const events = cal ? await cal.upcoming(14) : [];
    const dismissed = new Set(metaJson<string[]>('dismissedEvents', []));
    const added = metaJson<Record<string, string>>('addedEvents', {});
    const proposals = store
      .listInbox()
      .filter((m) => m.analysis?.event && !dismissed.has(m.id))
      .map((m) => {
        const ev = m.analysis!.event!;
        return {
          mailId: m.id,
          fromName: m.fromName,
          subject: m.subject,
          event: ev,
          added: added[m.id] ?? null,
          conflict: added[m.id] ? null : (conflictWith(ev.start, ev.end, events)?.title ?? null),
        };
      })
      .sort((a, b) => a.event.start.localeCompare(b.event.start));
    return c.json({ connected: Boolean(cal), events, proposals });
  });

  app.get('/api/agenda/range', async (c) => {
    const { from = '', to = '' } = c.req.query();
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (!day.test(from) || !day.test(to) || !(b > a) || b - a > 62 * 86400_000) return c.json({ error: 'Plage invalide (62 jours maximum)' }, 400);
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    return c.json({ events: await cal.range(localIso(from, '00:00:00'), localIso(to, '23:59:59')) });
  });

  app.post('/api/search', async (c) => {
    const { question } = await c.req.json<{ question?: string }>();
    if (!question?.trim()) return c.json({ error: 'Pose une question' }, 400);
    return c.json(await searchMail(d.runner, d.gmail(), question.slice(0, 500), d.archive));
  });

  app.post('/api/agenda/dismiss/:mailId', (c) => {
    const set = new Set(metaJson<string[]>('dismissedEvents', []));
    set.add(c.req.param('mailId'));
    store.setMeta('dismissedEvents', JSON.stringify([...set]));
    return c.json({ ok: true });
  });

  app.post('/api/agenda/events', async (c) => {
    const b = await c.req.json<{ title?: string; start?: string; end?: string; location?: string | null }>();
    const title = String(b.title ?? '').trim().slice(0, 200);
    const start = String(b.start ?? '');
    const end = String(b.end ?? '');
    if (!title || !ISO_DATETIME.test(start) || !ISO_DATETIME.test(end) || Date.parse(end) <= Date.parse(start))
      return c.json({ error: 'Titre, début et fin valides requis (la fin après le début)' }, 400);
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    return c.json(await cal.create({ title, start, end, location: String(b.location ?? '').trim() || null }));
  });

  app.post('/api/mail/:id/slots', async (c) => {
    const mail = store.getMail(c.req.param('id'));
    if (!mail) return c.json({ error: 'Mail introuvable' }, 404);
    const cal = d.calendar?.();
    const events = cal ? await cal.upcoming(14) : [];
    const res = await proposeSlots(d.runner, { mail, agenda: formatAgenda(events) });
    const now = Date.now();
    const slots = res.slots.filter(
      (s) => ISO_DATETIME.test(s.start) && ISO_DATETIME.test(s.end) && Date.parse(s.start) > now && Date.parse(s.end) > Date.parse(s.start) && !conflictWith(s.start, s.end, events),
    );
    return c.json({ slots, draft: res.draft });
  });

  app.post('/api/mail/:id/event', async (c) => {
    const ev = store.getMail(c.req.param('id'))?.analysis?.event;
    if (!ev) return c.json({ error: 'Aucun rendez-vous détecté dans ce mail' }, 404);
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    const res = await cal.create(ev);
    const added = metaJson<Record<string, string>>('addedEvents', {});
    added[c.req.param('id')] = res.link;
    store.setMeta('addedEvents', JSON.stringify(added));
    return c.json(res);
  });

  app.get('/api/cleanup', (c) => c.json(cleanupView(store)));

  app.post('/api/cleanup', async (c) => {
    const b = await c.req.json<{ trashIds?: string[]; unsubscribe?: string[] }>();
    const g = gmail();
    let trashed = 0;
    for (const id of b.trashIds ?? []) {
      if (!store.getMail(id)) continue;
      await trash(g, store, id);
      trashed++;
    }
    let unsubscribed = 0;
    const toOpen: string[] = [];
    const from = (b.unsubscribe ?? []).length ? await myEmail() : '';
    for (const sender of b.unsubscribe ?? []) {
      const r = await unsubscribe(g, store, sender, from, d.fetchImpl);
      if (r.done) unsubscribed++;
      else if (r.url) toOpen.push(r.url);
    }
    return c.json({ trashed, unsubscribed, toOpen });
  });

  // --- Newsletters: 6-month scan and bulk unsubscribe ---
  app.get('/api/newsletters', (c) =>
    c.json({ senders: JSON.parse(store.getMeta('newsletters') ?? '[]'), unsubscribed: unsubscribedSenders(store) }),
  );

  app.post('/api/newsletters/scan', async (c) => {
    const senders = await adviseNewsletters(d.runner, await scanNewsletters(gmail(), store));
    store.setMeta('newsletters', JSON.stringify(senders));
    return c.json({ senders, unsubscribed: unsubscribedSenders(store) });
  });

  app.post('/api/newsletters/unsubscribe', async (c) => {
    const { senders, trash: alsoTrash } = await c.req.json<{ senders?: string[]; trash?: boolean }>();
    const g = gmail();
    const from = await myEmail();
    const scanned = JSON.parse(store.getMeta('newsletters') ?? '[]') as { fromEmail: string; ids?: string[] }[];
    let unsubscribed = 0;
    let trashed = 0;
    const toOpen: string[] = [];
    for (const sender of senders ?? []) {
      const r = await unsubscribe(g, store, sender, from, d.fetchImpl);
      if (r.done) unsubscribed++;
      else if (r.url) toOpen.push(r.url);
      if (alsoTrash) {
        const ids = scanned.find((n) => n.fromEmail === sender.toLowerCase())?.ids ?? [];
        for (const id of ids) {
          await g.trash(id);
          trashed++;
        }
        store.removeFromInbox(ids);
      }
    }
    return c.json({ unsubscribed, trashed, toOpen });
  });

  // --- Admin ---
  const defaults = () => ({ model: d.cfg.model, intervalMin: d.cfg.intervalMin });

  app.get('/api/admin', async (c) => {
    const st = d.status();
    const connected = Boolean(d.oauth.hasCredentials() && d.oauth.isConnected() && d.gmail());
    let account: string | null = null;
    if (connected) account = await myEmail().catch(() => null);
    return c.json({
      claude: d.claudeInfo ? await d.claudeInfo() : { installed: false, version: null },
      google: { hasCredentials: d.oauth.hasCredentials(), connected, account, scopes: SCOPES },
      settings: getSettings(store, defaults()),
      lastSync: Number(store.getMeta('lastSync') ?? 0) || null,
      lastTriage: Number(store.getMeta('lastTriage') ?? 0) || null,
      running: st.running,
      error: st.error,
      counts: store.counts(),
      analyzing: store.countUnanalyzed(),
      pushDevices: store.listPushSubs().length,
      unsubscribed: unsubscribedSenders(store).length,
      archive: d.archive
        ? { count: d.archive.count(), oldest: d.archive.oldest(), done: store.getMeta('archiveDone') === '1' }
        : null,
      home: d.cfg.home,
      port: d.cfg.port,
    });
  });

  app.put('/api/admin/settings', async (c) => {
    try {
      saveSettings(store, await c.req.json());
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    return c.json(getSettings(store, defaults()));
  });

  app.post('/api/admin/claude-test', async (c) =>
    c.json(d.claudeTest ? await d.claudeTest() : { ok: false, ms: 0, error: 'Test indisponible' }),
  );

  // --- Backups (daily, automatic; manual and restore from Admin) ---
  app.get('/api/backup', (c) =>
    c.json(d.backup ? { dir: d.backup.dir, backups: listBackups(d.backup.dir), last: Number(store.getMeta('lastBackup') ?? 0) || null } : { dir: null, backups: [], last: null }),
  );

  app.post('/api/backup/now', (c) => {
    if (!d.backup) return c.json({ error: 'Backups unavailable' }, 400);
    const b = backupNow(store, d.backup.dir);
    pruneBackups(d.backup.dir, 7);
    store.setMeta('lastBackup', String(Date.now()));
    return c.json(b);
  });

  // Overwrites the whole database at the next start: only from the computer itself.
  app.post('/api/backup/restore', async (c) => {
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calme' }, 403);
    if (!d.backup) return c.json({ error: 'Backups unavailable' }, 400);
    const { name } = await c.req.json<{ name?: string }>();
    try {
      stageRestore(d.backup.dir, String(name ?? ''), d.backup.dbPath);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    d.restart?.();
    return c.json({ ok: true });
  });

  // --- iPhone link through Tailscale ---
  app.get('/api/remote', async (c) => c.json(d.remote ? await d.remote.status() : { installed: false, serving: false, url: null }));

  app.post('/api/remote/enable', async (c) => {
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calme' }, 403);
    if (!d.remote) return c.json({ error: 'Unavailable' }, 400);
    return c.json(await d.remote.enable());
  });

  app.get('/api/push/devices', (c) =>
    c.json(store.listPushSubs().map((p) => ({ endpoint: p.endpoint, name: p.name ?? 'Appareil', addedAt: p.addedAt ?? null }))),
  );

  app.post('/api/push/devices/remove', async (c) => {
    const { endpoint } = await c.req.json<{ endpoint?: string }>();
    if (endpoint) store.removePushSub(endpoint);
    return c.json({ ok: true });
  });

  app.post('/api/push/test', async (c) => {
    const { endpoint } = await c.req.json<{ endpoint?: string }>();
    return c.json({ ok: endpoint ? await d.notifier.test(endpoint) : false });
  });

  app.get('/api/push/key', (c) => c.json({ publicKey: d.cfg.vapid.publicKey }));

  app.post('/api/push/subscribe', async (c) => {
    const sub = await c.req.json<PushSub>();
    if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) return c.json({ error: 'Abonnement invalide' }, 400);
    const name = deviceName(c.req.header('user-agent'));
    store.addPushSub({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, name, addedAt: Date.now() });
    return c.json({ ok: true });
  });

  return app;
}
