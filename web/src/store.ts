import { reactive, ref } from 'vue';
import { api, getToken, setToken, Unauthorized, type AppState } from './api.ts';

/** App-wide state shared by every screen: mailbox state, toast, theme and the pairing status. */
export const store = reactive({
  paired: Boolean(getToken()),
  state: null as AppState | null,
  toast: null as { text: string; err?: boolean } | null,
  theme: document.documentElement.dataset.theme || 'dark',
});

export interface Draft {
  mailId?: string;
  text?: string;
  /** Open the editor and immediately ask Calme for free slots from the calendar. */
  slots?: boolean;
}
export const draft = ref<Draft>({});

let toastTimer = 0;
export function notify(text: string, err = false) {
  store.toast = { text, err };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (store.toast = null), 4000);
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

export function toggleTheme() {
  const next = store.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#0D0E11' : '#EAE9E4');
  try {
    localStorage.setItem('calme.theme', next);
  } catch {
    /* not persisted */
  }
  store.theme = next;
}

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
