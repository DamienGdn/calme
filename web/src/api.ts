import { ref, watch, type Ref } from 'vue';
import type { Category, MailView } from '../../server/src/types.ts';
import { farDate } from './dates.ts';
import { dateLocale, i18n } from './i18n.ts';

export type { Category, MailView };

/** A mail as listed in /api/state: everything but the body, fetched on demand with useMailBody. */
export type MailItem = Omit<MailView, 'text'>;

/** Something to do later, often taken from a mail (server/src/reminders.ts). */
export interface Reminder {
  id: string;
  text: string;
  due: number | null;
  /** Also warn this many minutes before: 0, 60 or 1440. */
  early: number;
  mailId: string | null;
  mailSubject: string | null;
  mailFrom: string | null;
  createdAt: number;
  done: boolean;
  doneAt: number | null;
}

export interface AppState {
  gmail: 'connected' | 'disconnected' | 'no-credentials';
  counts: Record<Category, number>;
  emails: MailItem[];
  lastSync: number | null;
  analyzing: number;
  running: boolean;
  error: string | null;
  language?: 'fr' | 'en';
  /** Load the images of formatted mails (Admin › App). */
  remoteImages?: boolean;
  /** Signature added when sending ('' when off). */
  signature?: string;
  setupDone?: boolean;
  /** Reminder alerts of the last day (server/src/notify.ts). */
  alerts?: { id: string; title: string; body: string; url: string; at: number }[];
}

export interface CleanupView {
  groups: { group: string; count: number; ids: string[] }[];
  newsletters: { fromName: string; fromEmail: string; count: number; ids: string[]; canUnsub: boolean }[];
}

declare global {
  interface Window {
    calmeDesktop?: { setToken(token: string): void; platform?: string };
  }
}

const KEY = 'calme.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: token lives for this page only */
  }
  if (token) window.calmeDesktop?.setToken(token);
  linkManifest(token);
}

/**
 * On iPhone the home-screen app does not share Safari's storage. Once this page is paired, its manifest asks the
 * server for a start URL that carries the pairing, so the icon added from here pairs itself on first launch.
 */
export function linkManifest(token: string | null = getToken()) {
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', token ? `/manifest.webmanifest?k=${encodeURIComponent(token)}` : '/manifest.webmanifest');
}

export class Unauthorized extends Error {}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new Unauthorized();
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });

export const CAT_COLOR: Record<Category, string> = {
  reply: 'var(--hot)',
  read: 'var(--read)',
  news: 'var(--news)',
  trash: 'var(--trash)',
};
export const CAT_CLASS: Record<Category, string> = { reply: 'c-reply', read: 'c-read', news: 'c-news', trash: 'c-trash' };

/** Full date and time of a mail, e.g. "jeudi 12 novembre 2026 à 18:56". */
export function fullDate(ts: number): string {
  const d = new Date(ts);
  const loc = dateLocale();
  return i18n.global.t('common.at', {
    day: d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
  });
}

/** Short, human date: time today, "yesterday", weekday this week, else day + month. */
export function when(ts: number): string {
  const loc = dateLocale();
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return i18n.global.t('common.yesterday');
  if (now.getTime() - ts < 6 * 86400_000) return d.toLocaleDateString(loc, { weekday: 'short' });
  return farDate(ts, now, loc);
}

/** Full text of a mail, loaded when it is opened (the list only carries headers). */
export function useMailBody(id: Ref<string | undefined>, source: Ref<'inbox' | 'archive' | 'gmail'> = ref('inbox')) {
  const body = ref<string | null>(null);
  watch(
    [id, source],
    async ([mailId, src], _old, onCleanup) => {
      body.value = null;
      if (!mailId) return;
      let alive = true;
      onCleanup(() => (alive = false));
      const path = src === 'archive' ? '/api/archive/' : src === 'gmail' ? '/api/gmail/' : '/api/mail/';
      try {
        const m = await api<MailView>(path + encodeURIComponent(mailId));
        if (alive) body.value = m.text;
      } catch {
        if (alive) body.value = '';
      }
    },
    { immediate: true },
  );
  return body;
}
