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
