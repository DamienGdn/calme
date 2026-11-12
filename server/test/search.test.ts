import { describe, expect, it } from 'vitest';
import { searchMail } from '../src/search.ts';

describe('search answer layout', () => {
  it('returns themed sections of short points, cleaned and capped', async () => {
    const runner = async (i: { schema: unknown }) =>
      JSON.stringify(i.schema).includes('gmailQuery')
        ? { gmailQuery: 'poce', keywords: ['Pocé'], explanation: '' }
        : {
            lead: 'Signature le **19 novembre à 11h**.',
            sections: [
              { title: 'Terrain et notaire', points: ['Dossier **1024060** chez **Aurore Picoreau**', ' ', 'Projets d’actes envoyés le **10/11**'] },
              { title: '', points: ['sans titre'] },
              { title: 'Prêt', points: [] },
            ],
            points: [],
            relevantIds: [],
          };
    const g = { listInboxIds: async () => ['m1'], getHeaders: async () => ({ From: 'Notaire <n@x.fr>', Subject: 'Dossier', __date: '1' }) };
    const r = await searchMail(runner as never, g as never, 'Pocé les bois');
    expect(r.lead).toBe('Signature le **19 novembre à 11h**.');
    expect(r.sections).toEqual([{ title: 'Terrain et notaire', points: ['Dossier **1024060** chez **Aurore Picoreau**', 'Projets d’actes envoyés le **10/11**'] }]);
  });
});

describe('search across mail and agenda', () => {
  it('looks for the keywords in the agenda too, and answers from both', async () => {
    const prompts: string[] = [];
    const runner = async (i: { schema: unknown; prompt: string }) => {
      prompts.push(i.prompt);
      return JSON.stringify(i.schema).includes('gmailQuery')
        ? { gmailQuery: 'dentiste', keywords: ['dentiste', 'Dr Martin', 'dentiste'], explanation: '' }
        : { lead: 'Dentiste le **14 novembre**.', sections: [], points: [], relevantIds: [] };
    };
    const asked: string[] = [];
    const calendar = {
      search: async (q: string) => {
        asked.push(q);
        return q === 'dentiste'
          ? [{ id: 'e1', title: 'Dentiste', start: '2026-11-14T10:00:00+01:00', end: '2026-11-14T11:00:00+01:00', allDay: false, location: 'Tours' }]
          : [{ id: 'e1', title: 'Dentiste', start: '2026-11-14T10:00:00+01:00', end: '2026-11-14T11:00:00+01:00', allDay: false }];
      },
    };
    const r = await searchMail(runner as never, null, 'quand est mon dentiste', undefined, calendar as never);
    expect(asked).toEqual(['dentiste', 'Dr Martin']);
    expect(r.events.map((e) => e.title)).toEqual(['Dentiste']);
    expect(r.lead).toBe('Dentiste le **14 novembre**.');
    expect(prompts[1]).toContain('<event');
    expect(prompts[1]).toContain('Dentiste');
  });
});
