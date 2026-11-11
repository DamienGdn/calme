import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gmail as gmailApi, type gmail_v1 } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';
import { writePrivate } from './config.ts';
import { createThrottle } from './throttle.ts';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  // Read the list of the user's calendars (to show all of them, not just the main one).
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export interface GmailPort {
  listInboxIds(q: string, max: number): Promise<string[]>;
  listByLabel(labelId: string, max: number): Promise<string[]>;
  listPage(q: string, pageToken?: string): Promise<{ ids: string[]; next?: string }>;
  get(id: string): Promise<gmail_v1.Schema$Message>;
  getHeaders(id: string): Promise<Record<string, string>>;
  modify(id: string, add: string[], remove: string[]): Promise<void>;
  trash(id: string): Promise<void>;
  untrash(id: string): Promise<void>;
  /** The signature set in Gmail for the main address (HTML). */
  signature(): Promise<string>;
  /** An attachment's bytes, base64url-encoded. */
  attachment(messageId: string, attachmentId: string): Promise<string>;
  send(raw: string, threadId?: string): Promise<void>;
  listLabels(): Promise<{ id: string; name: string }[]>;
  profileEmail(): Promise<string>;
}

export class GmailDisconnected extends Error {
  constructor() {
    super('Gmail non connecté ou autorisation révoquée');
  }
}

export class MissingCredentials extends Error {
  constructor(path: string) {
    super(`Fichier ${path} introuvable : crée un client OAuth « Application de bureau » dans Google Cloud (voir README).`);
  }
}

/** A Google OAuth client file ("Desktop app" or "Web"), as downloaded from Google Cloud. */
export function validateCredentials(raw: unknown): boolean {
  const c = (raw as { installed?: unknown; web?: unknown })?.installed ?? (raw as { web?: unknown })?.web;
  const o = c as { client_id?: unknown; client_secret?: unknown } | undefined;
  return typeof o?.client_id === 'string' && /\.apps\.googleusercontent\.com$/.test(o.client_id) && typeof o.client_secret === 'string' && o.client_secret.length > 0;
}

export function createOAuth(home: string) {
  const credPath = join(home, 'credentials.json');
  const tokenPath = join(home, 'token.json');

  function client(redirect?: string): OAuth2Client {
    if (!existsSync(credPath)) throw new MissingCredentials(credPath);
    const raw = JSON.parse(readFileSync(credPath, 'utf8'));
    const c = raw.installed ?? raw.web;
    const oauth = new OAuth2Client({ clientId: c.client_id, clientSecret: c.client_secret, redirectUri: redirect });
    if (existsSync(tokenPath)) oauth.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));
    oauth.on('tokens', (t) => {
      const prev = existsSync(tokenPath) ? JSON.parse(readFileSync(tokenPath, 'utf8')) : {};
      writePrivate(tokenPath, JSON.stringify({ ...prev, ...t }, null, 2));
    });
    return oauth;
  }

  return {
    saveCredentials(raw: unknown) {
      if (!validateCredentials(raw)) throw new Error('Not a Google OAuth client file');
      writePrivate(credPath, JSON.stringify(raw, null, 2));
    },
    hasCredentials: () => existsSync(credPath),
    isConnected: () => existsSync(tokenPath),
    client: () => client(),
    authUrl: (redirect: string) =>
      client(redirect).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES }),
    async exchange(code: string, redirect: string): Promise<void> {
      const c = client(redirect);
      const { tokens } = await c.getToken(code);
      writePrivate(tokenPath, JSON.stringify(tokens, null, 2));
    },
  };
}

function isAuthError(e: unknown): boolean {
  const err = e as { response?: { data?: { error?: string } }; message?: string; status?: number };
  return err?.response?.data?.error === 'invalid_grant' || /invalid_grant|No refresh token/i.test(err?.message ?? '') || err?.status === 401;
}

function isRateLimit(e: unknown): boolean {
  const err = e as { status?: number; code?: number; message?: string };
  return err?.status === 429 || err?.code === 429 || /quota exceeded|rate limit/i.test(err?.message ?? '');
}

/**
 * Gmail quota (projects created after May 2026): 6,000 units per user per minute.
 * Every call takes its cost from a shared 5,000-unit budget (safety margin), then runs;
 * a 429 still slipping through is retried after a pause.
 */
export const COST = { list: 5, getFull: 60, getMeta: 20, modify: 5, trash: 20, untrash: 20, attachment: 5, send: 100, labels: 1, profile: 1 } as const;
const take = createThrottle(5000);

/** Gmail's own per-user limit, shown in the quota gauge (Calm keeps below its 5,000-unit budget). */
export const GMAIL_USER_LIMIT = 6000;
export const quotaUsage = () => ({ ...take.usage(), limit: GMAIL_USER_LIMIT });

async function callWith<T>(cost: number, fn: () => Promise<T>, background = false, retries = 3): Promise<T> {
  await take(cost, background);
  try {
    return await fn();
  } catch (e) {
    if (isAuthError(e)) throw new GmailDisconnected();
    if (isRateLimit(e) && retries > 0) {
      await new Promise((r) => setTimeout(r, 20_000));
      return callWith(cost, fn, background, retries - 1);
    }
    throw e;
  }
}

/** `background: true` for scheduled work (relève, base locale, scan): it yields to interactive calls. */
export function createGmailPort(auth: OAuth2Client, background = false): GmailPort {
  const api = gmailApi({ version: 'v1', auth });
  const users = api.users;
  const call = <T,>(cost: number, fn: () => Promise<T>) => callWith(cost, fn, background);
  return {
    async listInboxIds(q, max) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const res = await call(COST.list, () => users.messages.list({ userId: 'me', q, maxResults: Math.min(100, max - ids.length), pageToken }));
        for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && ids.length < max);
      return ids;
    },
    async listPage(q, pageToken) {
      const res = await call(COST.list, () => users.messages.list({ userId: 'me', q, maxResults: 100, pageToken }));
      return {
        ids: (res.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)),
        next: res.data.nextPageToken ?? undefined,
      };
    },
    async listByLabel(labelId, max) {
      const res = await call(COST.list, () => users.messages.list({ userId: 'me', labelIds: [labelId], maxResults: max }));
      return (res.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    },
    async getHeaders(id) {
      const res = await call(COST.getMeta, () =>
        users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Date', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post'] }),
      );
      const heads = Object.fromEntries((res.data.payload?.headers ?? []).map((h) => [h.name ?? '', h.value ?? '']));
      return { ...heads, __labels: (res.data.labelIds ?? []).join(','), __snippet: res.data.snippet ?? '', __date: res.data.internalDate ?? '' };
    },
    async get(id) {
      return (await call(COST.getFull, () => users.messages.get({ userId: 'me', id, format: 'full' }))).data;
    },
    async modify(id, addLabelIds, removeLabelIds) {
      await call(COST.modify, () => users.messages.modify({ userId: 'me', id, requestBody: { addLabelIds, removeLabelIds } }));
    },
    async trash(id) {
      await call(COST.trash, () => users.messages.trash({ userId: 'me', id }));
    },
    async untrash(id) {
      await call(COST.untrash, () => users.messages.untrash({ userId: 'me', id }));
    },
    async signature() {
      const res = await call(COST.list, () => users.settings.sendAs.list({ userId: 'me' }));
      const all = res.data.sendAs ?? [];
      return (all.find((a) => a.isPrimary) ?? all.find((a) => a.isDefault) ?? all[0])?.signature ?? '';
    },
    async attachment(messageId, id) {
      return (await call(COST.attachment, () => users.messages.attachments.get({ userId: 'me', messageId, id }))).data.data ?? '';
    },
    async send(raw, threadId) {
      await call(COST.send, () => users.messages.send({ userId: 'me', requestBody: { raw, threadId } }));
    },
    async listLabels() {
      const res = await call(COST.labels, () => users.labels.list({ userId: 'me' }));
      return (res.data.labels ?? [])
        .filter((l) => l.type === 'user' && l.id && l.name)
        .map((l) => ({ id: l.id as string, name: l.name as string }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    },
    async profileEmail() {
      return (await call(COST.profile, () => users.getProfile({ userId: 'me' }))).data.emailAddress ?? '';
    },
  };
}
