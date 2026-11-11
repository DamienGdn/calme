import { onBeforeUnmount, ref, watch } from 'vue';
import { emptyTabs, type TabsState } from './tabLogic.ts';

/** Reading tabs of the triage screen, kept across screens and restarts (per device). */
const KEY = 'calme.tabs';

function load(): TabsState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TabsState> | null;
    if (v && Array.isArray(v.ids)) {
      const ids = v.ids.filter((x): x is string => typeof x === 'string');
      const pick = (x: unknown) => (typeof x === 'string' && ids.includes(x) ? x : null);
      return { ids, active: pick(v.active), compare: pick(v.compare), prev: pick(v.prev) };
    }
  } catch {
    /* unreadable: start empty */
  }
  return emptyTabs();
}

export const tabs = ref<TabsState>(load());
watch(tabs, (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* not persisted */
  }
});

export const updateTabs = (f: (s: TabsState) => TabsState) => {
  tabs.value = f(tabs.value);
};

/** Reactive media query, released with the component. */
export function useMedia(query: string) {
  const mql = window.matchMedia(query);
  const on = ref(mql.matches);
  const change = (e: MediaQueryListEvent) => (on.value = e.matches);
  mql.addEventListener('change', change);
  onBeforeUnmount(() => mql.removeEventListener('change', change));
  return on;
}
