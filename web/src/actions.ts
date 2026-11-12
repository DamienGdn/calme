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
