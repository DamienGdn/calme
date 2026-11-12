import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { archive, cleanupView, label, MAX_ATTACHMENTS_BYTES, NotFound, sendReply, setRead, trash, unsubscribe, untrash } from './actions.ts';
import { conflictWith, formatAgenda, ISO_DATETIME, localIso, REMINDERS, TIMEZONE, type CalendarPort, type NewEvent } from './calendar.ts';
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
import { draftQuestions, proposeSlots, readAgenda, redraft, suggestReminder, suggestSubject, type Tone } from './triage.ts';
import { searchMail } from './search.ts';
import { backupNow, listBackups, pruneBackups, stageRestore } from './backup.ts';
import type { Archive } from './archive.ts';
import { openReminders } from './reminders.ts';
import { composeMail } from './triage.ts';
import { CATEGORIES, type Category, type PushSub } from './types.ts';

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
  name: 'Calm',
  short_name: 'Calm',
  description: 'Your Gmail, sorted by Calm.',
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
    if (!isLocalRequest(c)) return c.text('Connexion Gmail possible uniquement depuis le PC qui fait tourner Calm.', 403);
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
    return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calm</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0D0E11;color:#EDEBE5;font:16px system-ui">
<div style="max-width:460px;padding:24px;text-align:center">
<div style="width:72px;height:72px;margin:0 auto 20px;border-radius:18px;background:#C8F03C;color:#0D0E11;display:grid;place-items:center;font:italic 44px Georgia,serif">c.</div>
<h1 style="font:italic 400 40px Georgia,serif;margin:0 0 12px">${en ? 'Gmail is connected.' : 'Gmail est connecté.'}</h1>
<p style="color:#9C9BA3;line-height:1.6">${en ? 'You can close this tab and go back to Calm: it continues on its own.' : 'Tu peux fermer cet onglet et revenir dans Calm : il continue tout seul.'}</p>
<p><a href="/" style="color:#C8F03C">${en ? 'Open Calm here' : 'Ouvrir Calm ici'}</a></p></div>
<script>setTimeout(function(){window.close()},2500)</script></body>`);
  });

  // --- Pairing token on every API route ---
  // Pairing a screen from afar: the iPhone home-screen app has its own storage, so the QR code (which pairs Safari)
  // cannot reach it. The screen asks; the user approves on the computer running Calm; the screen picks up the token
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
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calm' }, 403);
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
      signature: getSettings(store, defaults()).signatureOn ? getSettings(store, defaults()).signature : '',
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
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calm' }, 403);
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
    if (!b.brief?.trim()) return c.json({ error: 'Dis à Calm ce que tu veux écrire' }, 400);
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

  app.get('/api/gmail/:id', async (c) => {
    const { html: _html, ...m } = parseGmailMessage(await gmail().get(c.req.param('id')));
    return c.json(m);
  });

  // A folder mail's formatted version (not stored: read from Gmail), cleaned, with its embedded images.
  app.get('/api/gmail/:id/html', async (c) => {
    const id = c.req.param('id');
    const g = gmail();
    const msg = await g.get(id);
    let html = parseGmailMessage(msg).html ?? '';
    if (/\bcid:/i.test(html)) html = await embedImages(g, id, html, msg);
    return c.json({ html: html ? safeMailHtml(html) : null });
  });

  app.get('/api/mail/:id', (c) => {
    const m = store.getMail(c.req.param('id'));
    if (!m) return c.json({ error: 'Mail introuvable' }, 404);
    const { html: _html, ...rest } = m;
    return c.json(rest);
  });

  // The mail's formatted version, cleaned (mailHtml.ts). Mails stored before Calm kept HTML get it from Gmail once.
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

  // "Handled": a mail leaves "to answer" without a reply from Calm (and comes back with Undo).
  app.post('/api/mail/:id/category', async (c) => {
    const { category } = await c.req.json<{ category?: unknown }>();
    if (!CATEGORIES.includes(category as Category)) return c.json({ error: 'Unknown category' }, 400);
    const id = c.req.param('id');
    if (!store.getMail(id)?.analysis) return c.json({ error: 'Mail introuvable' }, 404);
    store.setCategory(id, category as Category);
    return c.json({ ok: true });
  });

  // Read state: opening a mail marks it read; "Mark unread" from the mail, a selection or a swipe.
  app.post('/api/mails/read', async (c) => {
    const { ids, read } = await c.req.json<{ ids?: unknown; read?: unknown }>();
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((x) => typeof x === 'string') || typeof read !== 'boolean')
      return c.json({ error: 'ids et read attendus' }, 400);
    await setRead(gmail(), store, ids as string[], read);
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
          ...signed(field('body')),
          attachments: await Promise.all(
            files.map(async (f) => ({ filename: f.name, mimeType: f.type || 'application/octet-stream', data: Buffer.from(await f.arrayBuffer()) })),
          ),
        },
        await myEmail(),
      );
      return c.json({ ok: true });
    },
  );

  // The signature (Admin › Signature), when on, takes the place of the "[Prénom]" placeholder Calm's drafts end with.
  const signed = (body: string): { body: string; signature?: string } => {
    const { signature, signatureOn } = getSettings(store, defaults());
    if (!signatureOn || !signature.trim()) return { body };
    return { body: body.replace(/\s*\[(?:Prénom|First name)\]\s*$/, '').trimEnd(), signature };
  };

  // Imports the signature set in Gmail as it is, in HTML (cleaned again whenever a mail is sent).
  app.get('/api/signature/gmail', async (c) => c.json({ html: safeMailHtml(await gmail().signature()).trim() }));

  // Questions on what a reply draft leaves unknown; the answers then go to /api/redraft as an instruction.
  app.post('/api/reply/questions', async (c) => {
    const b = await c.req.json<{ mailId?: string; draft?: string }>();
    const draft = String(b.draft ?? '').trim();
    if (!draft) return c.json({ error: 'Brouillon vide' }, 400);
    const mail = store.getMail(String(b.mailId ?? ''));
    if (!mail) return c.json({ error: 'Mail introuvable' }, 404);
    return c.json({ questions: await draftQuestions(d.runner, { mail, draft: draft.slice(0, 8000) }) });
  });

  app.post('/api/subject', async (c) => {
    const { body } = await c.req.json<{ body?: string }>();
    const text = String(body ?? '').trim();
    if (!text) return c.json({ error: 'Message vide' }, 400);
    return c.json({ subject: await suggestSubject(d.runner, text.slice(0, 6000)) });
  });

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
    const cals = cal ? await cal.calendars() : { list: [], limited: false };
    const hidden = new Set(getSettings(store, defaults()).hiddenCalendars);
    return c.json({
      connected: Boolean(cal),
      events: events.filter((e) => !e.calendar || !hidden.has(e.calendar.id)),
      proposals,
      calendars: cals.list.map((x) => ({ ...x, hidden: hidden.has(x.id) })),
      limitedCalendars: cals.limited,
    });
  });

  app.get('/api/agenda/range', async (c) => {
    const { from = '', to = '' } = c.req.query();
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (!day.test(from) || !day.test(to) || !(b > a) || b - a > 62 * 86400_000) return c.json({ error: 'Plage invalide (62 jours maximum)' }, 400);
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    const hidden = new Set(getSettings(store, defaults()).hiddenCalendars);
    const events = await cal.range(localIso(from, '00:00:00'), localIso(to, '23:59:59'));
    return c.json({ events: events.filter((e) => !e.calendar || !hidden.has(e.calendar.id)) });
  });

  app.post('/api/search', async (c) => {
    const { question } = await c.req.json<{ question?: string }>();
    if (!question?.trim()) return c.json({ error: 'Pose une question' }, 400);
    return c.json(await searchMail(d.runner, d.gmail(), question.slice(0, 500), d.archive));
  });

  // Reminders: things to do later, typed in or taken from a mail ("not now").
  const reminders = openReminders(store.db);
  const reminderText = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().length <= 300 ? v.trim() : null);
  const reminderDue = (v: unknown): number | null | undefined =>
    v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;

  app.get('/api/reminders', (c) => c.json(reminders.list()));

  app.post('/api/reminders', async (c) => {
    const b = await c.req.json<{ text?: unknown; due?: unknown; mailId?: unknown }>();
    const text = reminderText(b.text);
    const due = reminderDue(b.due);
    if (!text || due === undefined) return c.json({ error: 'Texte (300 caractères max) et date valides attendus' }, 400);
    let mail: { id: string; subject: string; fromName: string } | undefined;
    if (b.mailId !== undefined) {
      const m = typeof b.mailId === 'string' ? store.getMail(b.mailId) : null;
      if (!m) return c.json({ error: 'Mail introuvable' }, 404);
      mail = { id: m.id, subject: m.subject, fromName: m.fromName };
    }
    return c.json(reminders.add({ text, due, mail }));
  });

  app.patch('/api/reminders/:id', async (c) => {
    const b = await c.req.json<{ text?: unknown; due?: unknown; done?: unknown }>();
    const patch: { text?: string; due?: number | null; done?: boolean } = {};
    if (b.text !== undefined) {
      const text = reminderText(b.text);
      if (!text) return c.json({ error: 'Texte invalide' }, 400);
      patch.text = text;
    }
    if (b.due !== undefined) {
      const due = reminderDue(b.due);
      if (due === undefined) return c.json({ error: 'Date invalide' }, 400);
      patch.due = due;
    }
    if (b.done !== undefined) {
      if (typeof b.done !== 'boolean') return c.json({ error: 'done invalide' }, 400);
      patch.done = b.done;
    }
    const r = reminders.update(c.req.param('id'), patch);
    return r ? c.json(r) : c.json({ error: 'Rappel introuvable' }, 404);
  });

  app.delete('/api/reminders/:id', (c) =>
    reminders.remove(c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Rappel introuvable' }, 404),
  );

  app.post('/api/mail/:id/reminder', async (c) => {
    const mail = store.getMail(c.req.param('id'));
    if (!mail) return c.json({ error: 'Mail introuvable' }, 404);
    return c.json(await suggestReminder(d.runner, mail));
  });

  // Calm's reading of the coming week; asked again only when the agenda, the reminders or the day change.
  app.post('/api/agenda/brief', async (c) => {
    const cal = d.calendar?.();
    const hidden = new Set(getSettings(store, defaults()).hiddenCalendars);
    const events = cal ? (await cal.upcoming(7)).filter((e) => !e.calendar || !hidden.has(e.calendar.id)) : [];
    const horizon = Date.now() + 7 * 86400_000;
    const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
    const open = reminders.list().filter((r) => !r.done && (r.due === null || r.due <= horizon));
    const remindersText = open.length
      ? open.map((r) => `- ${r.due === null ? 'sans date' : (r.due < Date.now() ? 'en retard, ' : '') + fmt.format(new Date(r.due))} : ${r.text}`).join('\n')
      : 'Aucun rappel.';
    const agenda = formatAgenda(events);
    const key = createHash('sha256').update([new Date().toDateString(), agenda, remindersText].join('\u0000')).digest('hex');
    const cached = metaJson<{ key?: string; glance: string; points: string[]; at: number } | null>('agendaBrief', null);
    if (cached?.key === key) return c.json({ glance: cached.glance, points: cached.points, at: cached.at });
    const brief = { ...(await readAgenda(d.runner, { agenda, reminders: remindersText })), at: Date.now() };
    store.setMeta('agendaBrief', JSON.stringify({ key, ...brief }));
    return c.json(brief);
  });

  app.post('/api/agenda/dismiss/:mailId', (c) => {
    const set = new Set(metaJson<string[]>('dismissedEvents', []));
    set.add(c.req.param('mailId'));
    store.setMeta('dismissedEvents', JSON.stringify([...set]));
    return c.json({ ok: true });
  });

  // Appointment form: timed or all-day (end day excluded), place, notes, reminder. Shared by create and edit.
  type EventBody = { title?: string; start?: string; end?: string; allDay?: boolean; location?: string | null; description?: string; reminderMin?: number };
  const eventFrom = (b: EventBody): NewEvent | string => {
    const title = String(b.title ?? '').trim().slice(0, 200);
    const start = String(b.start ?? '');
    const end = String(b.end ?? '');
    const allDay = b.allDay === true;
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    const valid = allDay ? DAY.test(start) && DAY.test(end) && end > start : ISO_DATETIME.test(start) && ISO_DATETIME.test(end) && Date.parse(end) > Date.parse(start);
    if (!title || !valid) return 'Titre, début et fin valides requis (la fin après le début)';
    if (b.reminderMin !== undefined && !REMINDERS.includes(b.reminderMin)) return 'Rappel inconnu';
    const description = String(b.description ?? '').trim().slice(0, 4000);
    return {
      title,
      start,
      end,
      location: String(b.location ?? '').trim().slice(0, 300) || null,
      allDay,
      ...(description ? { description } : {}),
      ...(b.reminderMin !== undefined ? { reminderMin: b.reminderMin } : {}),
    };
  };
  const writableCalendar = async (cal: CalendarPort, id: string) => (await cal.calendars()).list.some((x) => x.id === id && x.writable);

  app.post('/api/agenda/events', async (c) => {
    const b = await c.req.json<EventBody & { calendarId?: string }>();
    const e = eventFrom(b);
    if (typeof e === 'string') return c.json({ error: e }, 400);
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    if (b.calendarId !== undefined && !(await writableCalendar(cal, b.calendarId))) return c.json({ error: 'Agenda inconnu ou en lecture seule' }, 400);
    return c.json(await cal.create({ ...e, ...(b.calendarId !== undefined ? { calendarId: b.calendarId } : {}) }));
  });

  // Edit an appointment in place (same calendar).
  app.patch('/api/agenda/events/:calendarId/:eventId', async (c) => {
    const e = eventFrom(await c.req.json<EventBody>());
    if (typeof e === 'string') return c.json({ error: e }, 400);
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    const calendarId = c.req.param('calendarId');
    if (!(await writableCalendar(cal, calendarId))) return c.json({ error: 'Agenda inconnu ou en lecture seule' }, 400);
    return c.json(await cal.update(calendarId, c.req.param('eventId'), e));
  });

  // Delete an appointment, only from a calendar Calm may write to.
  app.delete('/api/agenda/events/:calendarId/:eventId', async (c) => {
    const cal = d.calendar?.();
    if (!cal) throw new GmailDisconnected();
    const calendarId = c.req.param('calendarId');
    if (!(await cal.calendars()).list.some((x) => x.id === calendarId && x.writable)) return c.json({ error: 'Agenda inconnu ou en lecture seule' }, 400);
    await cal.remove(calendarId, c.req.param('eventId'));
    return c.json({ ok: true });
  });

  // French address suggestions (Base Adresse Nationale, served by IGN's Géoplateforme). Only the typed text is sent.
  app.get('/api/address', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 200);
    if (q.length < 3) return c.json([]);
    const url = `https://data.geopf.fr/geocodage/search?${new URLSearchParams({ q, limit: '6', autocomplete: '1', index: 'address' })}`;
    try {
      const res = await (d.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      type Feature = { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> };
      const j = (await res.json()) as { features?: Feature[] };
      return c.json(
        (j.features ?? []).slice(0, 6).map((f) => ({
          label: String(f.properties?.label ?? ''),
          name: String(f.properties?.name ?? ''),
          postcode: String(f.properties?.postcode ?? ''),
          city: String(f.properties?.city ?? ''),
          context: String(f.properties?.context ?? ''),
          lat: Number(f.geometry?.coordinates?.[1]),
          lon: Number(f.geometry?.coordinates?.[0]),
        })),
      );
    } catch {
      return c.json({ error: 'Recherche d’adresse indisponible : saisis l’adresse à la main.' }, 502);
    }
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
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calm' }, 403);
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
    if (!isLocalRequest(c)) return c.json({ error: 'Only from the computer running Calm' }, 403);
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
