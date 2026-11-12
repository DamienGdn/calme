import { reactive, ref } from 'vue';
import { api, getToken, post, setToken, Unauthorized, type AppState } from './api.ts';
import { canRefract } from './glass.ts';
import { i18n } from './i18n.ts';
import { isUnread, withUnread } from './unread.ts';

/**
 * Liquid glass of the phone menu bar (see glass.ts): refraction strength (0 = off), depth of the bent rim and
 * chromatic aberration, all in px and applied by Chromium only; blur (px) and tint (% of the glass colour) everywhere.
 */
export interface Glass {
  strength: number;
  depth: number;
  aberration: number;
  blur: number;
  tint: number;
}
export const GLASS_DEFAULT: Glass = { strength: 80, depth: 10, aberration: 4, blur: 3, tint: 45 };
export const GLASS_MAX: Glass = { strength: 200, depth: 30, aberration: 20, blur: 20, tint: 90 };
const clampGlass = (g: Partial<Glass>): Glass =>
  Object.fromEntries(
    (Object.keys(GLASS_DEFAULT) as (keyof Glass)[]).map((k) => {
      const n = Number(g[k] ?? GLASS_DEFAULT[k]);
      return [k, Math.min(GLASS_MAX[k], Math.max(0, Number.isFinite(n) ? n : GLASS_DEFAULT[k]))];
    }),
  ) as unknown as Glass;
/** Where the settings are kept on this device (a new key: the earlier glass had other settings). */
const GLASS_KEY = 'calme.glass.v2';

function readGlass(): Glass {
  try {
    return clampGlass(JSON.parse(localStorage.getItem(GLASS_KEY) ?? '{}'));
  } catch {
    return { ...GLASS_DEFAULT };
  }
}

/** App-wide state shared by every screen: mailbox state, toast, theme and the pairing status. */
export const store = reactive({
  paired: Boolean(getToken()),
  state: null as AppState | null,
  toast: null as { text: string; err?: boolean; action?: ToastAction } | null,
  /** Theme actually shown. */
  theme: document.documentElement.dataset.theme || 'dark',
  /** Per-device choice: follow the device (iPhone, Mac…) or a fixed theme. */
  themePref: readThemePref(),
  /** Per-device look of the phone menu bar's liquid glass. */
  glass: readGlass(),
  /** Bumped when a reminder is saved anywhere, so lists and the agenda reading reload. */
  remindersVersion: 0,
});

export interface Draft {
  mailId?: string;
  text?: string;
  /** Open the editor and immediately ask Calm for free slots from the calendar. */
  slots?: boolean;
}
export const draft = ref<Draft>({});

/** A button in the toast, e.g. "Undo" after a trash. */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

let toastTimer = 0;
export function notify(text: string, err = false, action?: ToastAction) {
  store.toast = { text, err, action };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (store.toast = null), action ? 7000 : 4000);
}

export function runToastAction() {
  const a = store.toast?.action;
  store.toast = null;
  void a?.run();
}
export const notifyError = (e: unknown) => notify((e as Error).message, true);

export async function refresh() {
  try {
    store.state = await api<AppState>('/api/state');
    showBadge(store.state.emails.filter(isUnread).length);
    showAlerts(store.state.alerts ?? []);
  } catch (e) {
    if (e instanceof Unauthorized) {
      setToken(null);
      store.paired = false;
    }
  }
}

/**
 * Marks mails read or unread: shown at once, then saved in Gmail; on failure the list comes back as it was.
 * Mails already in that state are left alone (opening a read mail costs no call).
 */
export async function setRead(ids: string[], read: boolean) {
  const mails = (store.state?.emails ?? []).filter((m) => ids.includes(m.id) && isUnread(m) === read);
  if (!mails.length) return;
  const before = new Map(mails.map((m) => [m.id, m.labelIds]));
  for (const m of mails) m.labelIds = withUnread(m.labelIds, !read);
  try {
    await post('/api/mails/read', { ids: mails.map((m) => m.id), read });
  } catch (e) {
    for (const m of mails) m.labelIds = before.get(m.id) ?? m.labelIds;
    notifyError(e);
  }
}

/** Reminder alerts not shown on this device yet: a toast that leads to the reminders. */
const ALERT_KEY = 'calme.alertSeen';
function showAlerts(list: { id: string; title: string; body: string; at: number }[]) {
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(ALERT_KEY) ?? 0);
  } catch {
    /* not kept: show the latest */
  }
  const fresh = list.filter((a) => a.at > seen);
  if (!fresh.length) return;
  const last = fresh[fresh.length - 1];
  try {
    localStorage.setItem(ALERT_KEY, String(last.at));
  } catch {
    /* not kept */
  }
  notify(`${last.title} — ${last.body}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`, false, { label: i18n.global.t('remind.see'), run: () => goTo('rappels') });
}

/** Unread mails on the app icon (home-screen app; ignored where the Badging API is missing). */
function showBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  void (n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => {});
}

export type ThemePref = 'system' | 'light' | 'dark';

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem('calme.theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const theme = store.themePref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : store.themePref;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0D0E11' : '#EAE9E4');
  store.theme = theme;
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem('calme.theme');
    else localStorage.setItem('calme.theme', pref);
  } catch {
    /* not persisted */
  }
  store.themePref = pref;
  applyTheme();
}

// Following the device: switch live when it changes (e.g. iPhone automatic dark mode at night).
darkQuery.addEventListener('change', () => store.themePref === 'system' && applyTheme());
applyTheme();

export type Route = 'rappels' | 'tri' | 'ecrire' | 'menage' | 'desabonnements' | 'agenda' | 'dossiers' | 'admin' | 'recherche' | 'installation';
const ROUTES: Route[] = ['rappels', 'tri', 'ecrire', 'menage', 'desabonnements', 'agenda', 'dossiers', 'admin', 'recherche', 'installation'];

/** Hash routes: #/tri[/reply], #/dossiers[/<labelId>], #/recherche[/<question>]… */
export function parseHash(): { route: Route; arg: string } {
  const [r = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { route: (ROUTES as string[]).includes(r) ? (r as Route) : 'tri', arg };
}

export const goTo = (route: Route, arg?: string) => {
  location.hash = `/${route}${arg ? '/' + encodeURIComponent(arg) : ''}`;
};

export function openEditor(d: Draft) {
  draft.value = d;
  goTo('ecrire');
}

function applyGlass() {
  const s = document.documentElement.style;
  s.setProperty('--glass-blur', `${store.glass.blur}px`);
  s.setProperty('--glass-tint', `${store.glass.tint}%`);
  document.documentElement.classList.toggle('glass-refract', canRefract(navigator.userAgent) && store.glass.strength > 0);
}

export function setGlass(patch: Partial<Glass>) {
  store.glass = clampGlass({ ...store.glass, ...patch });
  try {
    localStorage.setItem(GLASS_KEY, JSON.stringify(store.glass));
  } catch {
    /* not persisted */
  }
  applyGlass();
}
applyGlass();
