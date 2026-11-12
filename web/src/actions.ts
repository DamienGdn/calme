/** What Calm's suggested action ("se désabonner ou supprimer") asks for, so the reader can offer it as buttons. */
export type ActionKind = 'unsub' | 'trash' | 'archive' | 'reply' | 'remind';

const RULES: [ActionKind, RegExp][] = [
  ['unsub', /desabonn|desinscri|unsubscri/],
  ['trash', /supprim|corbeille|jeter|delete|trash/],
  ['archive', /archiv/],
  ['reply', /repond|reply|answer/],
  ['remind', /plus tard|rappel|later|remind/],
];

export function actionKinds(action: string): ActionKind[] {
  const a = action.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return RULES.filter(([, re]) => re.test(a)).map(([k]) => k);
}

/** The folder an action asks to file the mail in ("ranger dans Factures" → "Factures"), or null. */
export function fileTarget(action: string): string | null {
  const m = /\b(?:ranger|classer|d[ée]placer|mettre|archiver|file(?:\s+it)?|move(?:\s+it)?|put(?:\s+it)?)\s+(?:dans|vers|en|under|into|in|to)\s+(?:le\s+dossier\s+|the\s+folder\s+)?[«"“]?\s*([^»"”,.;:!?()]+?)\s*(?:[»"”]|[,.;:!?()]|\s+puis\b|\s+then\b|\s+et\b|\s+and\b|$)/i.exec(action);
  const name = m?.[1]?.trim();
  return name && name.length <= 80 ? name : null;
}
