/**
 * Reading tabs: the mails kept open in the triage screen, like browser tabs.
 * Pure functions over an immutable state, so the rules are testable without Vue.
 */
export interface TabsState {
  /** Open mail ids, in tab order. */
  ids: string[];
  /** Mail shown in the main pane. */
  active: string | null;
  /** Mail shown next to it in compare mode. */
  compare: string | null;
  /** Previously active mail, the natural partner for a comparison. */
  prev: string | null;
}

export const MAX_TABS = 8;
export const emptyTabs = (): TabsState => ({ ids: [], active: null, compare: null, prev: null });

/** Shows an open tab; picking the compared mail swaps the two panes. */
export function activateTab(st: TabsState, id: string): TabsState {
  if (!st.ids.includes(id) || id === st.active) return st;
  return { ...st, active: id, prev: st.active, compare: st.compare === id ? st.active : st.compare };
}

/** Plain open replaces the active tab in place; background open adds a last tab without switching. */
export function openTab(st: TabsState, id: string, background = false): TabsState {
  if (st.ids.includes(id)) return activateTab(st, id);
  if (!st.active) return { ...st, ids: cap([...st.ids, id], id, st.compare), active: id };
  if (background) return { ...st, ids: cap([...st.ids, id], st.active, st.compare, id) };
  const ids = st.ids.map((x) => (x === st.active ? id : x));
  return { ...st, ids, active: id, prev: st.prev === id ? null : st.prev };
}

/** Drops the oldest tabs beyond MAX_TABS, never one that is on screen or was just opened. */
function cap(ids: string[], ...keep: (string | null)[]): string[] {
  const out = [...ids];
  for (let i = 0; out.length > MAX_TABS && i < out.length; ) {
    if (keep.includes(out[i])) i++;
    else out.splice(i, 1);
  }
  return out;
}

export function closeTab(st: TabsState, id: string): TabsState {
  const at = st.ids.indexOf(id);
  if (at < 0) return st;
  const ids = st.ids.filter((x) => x !== id);
  const active = st.active === id ? (ids[at] ?? ids[at - 1] ?? null) : st.active;
  const compare = st.compare === id || st.compare === active ? null : st.compare;
  return { ids, active, compare, prev: st.prev === id ? null : st.prev };
}

export function cycleTab(st: TabsState, dir: 1 | -1): TabsState {
  if (st.ids.length < 2 || !st.active) return st;
  const n = st.ids.length;
  return activateTab(st, st.ids[(st.ids.indexOf(st.active) + dir + n) % n]);
}

/** Starts a comparison with the previously shown tab (or a neighbour), or ends it. */
export function toggleCompare(st: TabsState): TabsState {
  if (st.compare) return { ...st, compare: null };
  if (!st.active || st.ids.length < 2) return st;
  const at = st.ids.indexOf(st.active);
  const other = st.prev && st.prev !== st.active && st.ids.includes(st.prev) ? st.prev : (st.ids[at + 1] ?? st.ids[at - 1]);
  return { ...st, compare: other ?? null };
}

/** Removes tabs whose mail left the inbox (archived, trashed, synced away). */
export function pruneTabs(st: TabsState, existing: Set<string>): TabsState {
  const gone = st.ids.filter((id) => !existing.has(id));
  return gone.reduce(closeTab, st);
}
