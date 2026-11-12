import type { Store } from './store.ts';

export const MODELS = ['haiku', 'sonnet', 'opus'] as const;
export type Model = (typeof MODELS)[number];

/** Depth of the local mail base, in months (0 = recent mail only). */
export const LANGUAGES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const PUSH_MODES = ['all', 'reply', 'off'] as const;
export type PushMode = (typeof PUSH_MODES)[number];

export const ARCHIVE_MONTHS = [0, 1, 3, 6, 12, 24, 36];

export interface Settings {
  autoUnsubscribe: boolean;
  keepSenders: string[];
  archiveMonths: number;
  language: Language;
  pushMode: PushMode;
  quietStart: number | null;
  quietEnd: number | null;
  /** Load the images of formatted mails (some senders use them to know a mail was opened). */
  remoteImages: boolean;
  /** Email signature, in Calm's light markup (lines, **bold**, links) or in HTML, and whether it is added when sending. */
  signature: string;
  signatureOn: boolean;
  /** Calendars not shown in the agenda (ids), for every device. */
  hiddenCalendars: string[];
  model: string;
  intervalMin: number;
}

/** User-editable settings (admin page), stored in the database; env/config values are the defaults. */
export function getSettings(s: Store, defaults: { model: string; intervalMin: number }): Settings {
  const saved = JSON.parse(s.getMeta('settings') ?? '{}') as Partial<Settings>;
  return { autoUnsubscribe: false, keepSenders: [], archiveMonths: 12, language: 'fr', pushMode: 'reply', quietStart: null, quietEnd: null, remoteImages: true, signature: '', signatureOn: false, hiddenCalendars: [], ...defaults, ...saved };
}

export function saveSettings(s: Store, patch: Partial<Settings>): void {
  const next: Partial<Settings> = JSON.parse(s.getMeta('settings') ?? '{}');
  if (patch.model !== undefined) {
    if (!MODELS.includes(patch.model as Model)) throw new Error(`Modèle inconnu : ${patch.model}`);
    next.model = patch.model;
  }
  if (patch.intervalMin !== undefined) {
    // 0.5 = every 30 seconds; otherwise whole minutes.
    const n = patch.intervalMin;
    if (n !== 0.5 && (!Number.isInteger(n) || n < 1 || n > 1440)) throw new Error('Intervalle : 30 s, ou entre 1 et 1440 minutes');
    next.intervalMin = patch.intervalMin;
  }
  if (patch.archiveMonths !== undefined) {
    if (!ARCHIVE_MONTHS.includes(patch.archiveMonths)) throw new Error(`Profondeur possible : ${ARCHIVE_MONTHS.join(', ')} mois`);
    next.archiveMonths = patch.archiveMonths;
  }
  if (patch.language !== undefined) {
    if (!LANGUAGES.includes(patch.language)) throw new Error(`Unknown language: ${patch.language}`);
    next.language = patch.language;
  }
  if (patch.pushMode !== undefined) {
    if (!PUSH_MODES.includes(patch.pushMode)) throw new Error(`Unknown push mode: ${patch.pushMode}`);
    next.pushMode = patch.pushMode;
  }
  for (const k of ['quietStart', 'quietEnd'] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 23)) throw new Error('Quiet hours are 0–23');
    next[k] = v;
  }
  if (patch.autoUnsubscribe !== undefined) next.autoUnsubscribe = Boolean(patch.autoUnsubscribe);
  if (patch.remoteImages !== undefined) next.remoteImages = Boolean(patch.remoteImages);
  if (patch.signature !== undefined) next.signature = String(patch.signature).replace(/\r\n/g, '\n').slice(0, 50_000);
  if (patch.signatureOn !== undefined) next.signatureOn = Boolean(patch.signatureOn);
  if (patch.hiddenCalendars !== undefined) {
    if (!Array.isArray(patch.hiddenCalendars)) throw new Error('hiddenCalendars must be a list');
    next.hiddenCalendars = [...new Set(patch.hiddenCalendars.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 300))].slice(0, 100);
  }
  if (patch.keepSenders !== undefined) {
    if (!Array.isArray(patch.keepSenders)) throw new Error('keepSenders doit être une liste');
    next.keepSenders = [...new Set(patch.keepSenders.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  }
  s.setMeta('settings', JSON.stringify(next));
}
