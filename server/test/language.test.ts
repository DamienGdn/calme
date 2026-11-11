import { describe, expect, it } from 'vitest';
import type { ClaudeRunner } from '../src/claude.ts';
import { withLanguage } from '../src/language.ts';

describe('withLanguage', () => {
  it('asks Calme to answer in English when the app is in English', async () => {
    const seen: string[] = [];
    const inner: ClaudeRunner = async (i) => {
      seen.push(i.system);
      return {};
    };
    await withLanguage(inner, () => 'en')({ system: 'Tu tries des mails.', prompt: 'x', schema: {} });
    await withLanguage(inner, () => 'fr')({ system: 'Tu tries des mails.', prompt: 'x', schema: {} });
    expect(seen[0]).toMatch(/English/);
    expect(seen[1]).toBe('Tu tries des mails.');
  });
});
