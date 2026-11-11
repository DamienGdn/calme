import type { ClaudeRunner } from './claude.ts';
import type { Language } from './settings.ts';

/**
 * Calm's prompts are written in French; when the app is in English, every answer
 * (summaries, actions, suggested replies, drafts, search answers) must come back in English.
 */
export function withLanguage(r: ClaudeRunner, lang: () => Language): ClaudeRunner {
  return (i) =>
    r(
      lang() === 'en'
        ? {
            ...i,
            system: `${i.system}\n\nIMPORTANT: write every text field of your answer (summaries, actions, labels, replies, drafts, subjects, reasons, answers) in English. Sign replies "[First name]" instead of "[Prénom]". Category ids and JSON keys stay unchanged.`,
          }
        : i,
    );
}
