/**
 * Selecting several mails with the keyboard held, as in file managers on macOS, Windows and Linux:
 * ⌘ (Mac) / Ctrl (Windows, Linux) + click adds or removes one mail, ⇧ + click adds the range from the last clicked.
 */
export function pickWith(sel: Set<string>, ids: string[], id: string, anchor: string | null, mode: 'toggle' | 'range'): Set<string> {
  const next = new Set(sel);
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  const to = ids.indexOf(id);
  if (mode === 'range' && from >= 0 && to >= 0) {
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(ids[i]);
    return next;
  }
  if (mode === 'toggle' && next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The "add one" modifier of the platform: ⌘ on a Mac, Ctrl elsewhere. */
export const toggleKey = (e: MouseEvent | KeyboardEvent) => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? e.metaKey : e.ctrlKey);
