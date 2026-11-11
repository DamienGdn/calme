import { reactive, ref } from 'vue';
import { api, getToken, setToken, Unauthorized, type AppState } from './api.ts';

/** Liquid glass of the phone menu bar: refraction strength (0 = off), blur (px) and tint (% of the surface colour). */
export interface Glass {
  refraction: number;
  blur: number;
  tint: number;
}
export const GLASS_DEFAULT: Glass = { refraction: 28, blur: 6, tint: 42 };
const clampGlass = (g: Partial<Glass>): Glass => ({
  refraction: Math.min(80, Math.max(0, Number(g.refraction ?? GLASS_DEFAULT.refraction))),
  blur: Math.min(24, Math.max(0, Number(g.blur ?? GLASS_DEFAULT.blur))),
  tint: Math.min(90, Math.max(0, Number(g.tint ?? GLASS_DEFAULT.tint))),
});

function readGlass(): Glass {
  try {
    return clampGlass(JSON.parse(localStorage.getItem('calme.glass') ?? '{}'));
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
  } catch (e) {
    if (e instanceof Unauthorized) {
      setToken(null);
      store.paired = false;
    }
  }
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

export type Route = 'tri' | 'ecrire' | 'menage' | 'desabonnements' | 'agenda' | 'dossiers' | 'admin' | 'recherche' | 'installation';
const ROUTES: Route[] = ['tri', 'ecrire', 'menage', 'desabonnements', 'agenda', 'dossiers', 'admin', 'recherche', 'installation'];

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
  document.documentElement.classList.toggle('glass-refract', store.glass.refraction > 0);
}

export function setGlass(patch: Partial<Glass>) {
  store.glass = clampGlass({ ...store.glass, ...patch });
  try {
    localStorage.setItem('calme.glass', JSON.stringify(store.glass));
  } catch {
    /* not persisted */
  }
  applyGlass();
}
applyGlass();
