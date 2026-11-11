import { describe, expect, it } from 'vitest';
import { openArchive } from '../src/archive.ts';
import { parseAddressList } from '../src/mime.ts';
import { openStore } from '../src/store.ts';
import { mail } from './fixtures.ts';

function setup() {
  const s = openStore(':memory:');
  return { s, a: openArchive(s.db) };
}

describe('parseAddressList', () => {
  it('splits recipients, keeping commas inside quoted names', () => {
    expect(parseAddressList('"Martin, Sophie" <s@x.fr>, bob@y.fr')).toEqual([
      { name: 'Martin, Sophie', email: 's@x.fr' },
      { name: 'bob@y.fr', email: 'bob@y.fr' },
    ]);
    expect(parseAddressList('')).toEqual([]);
  });
});

describe('archive', () => {
  it('stores mails once and finds them by words, accents ignored', () => {
    const { a } = setup();
    expect(a.add([mail('m1', { subject: 'Réunion du syndic', text: 'Assemblée générale à Rennes' }), mail('m2', { subject: 'Facture EDF' })])).toBe(2);
    expect(a.add([mail('m1')])).toBe(0);
    expect(a.has('m1')).toBe(true);
    const hits = a.search('reunion rennes', 10);
    expect(hits.map((h) => h.id)).toEqual(['m1']);
    expect(hits[0].text).toContain('Rennes');
    expect(a.count()).toBe(2);
  });

  it('survives FTS syntax characters in user queries', () => {
    const { a } = setup();
    a.add([mail('m1', { subject: 'Devis "toiture" 2026' })]);
    expect(a.search('devis "toiture" (AND) -*', 10).map((h) => h.id)).toEqual(['m1']);
    expect(a.search('   ', 10)).toEqual([]);
  });

  it('builds contacts, ranking people I wrote to above senders', () => {
    const { a } = setup();
    a.add([
      mail('r1', { fromName: 'Promo', fromEmail: 'promo@shop.fr' }),
      mail('r2', { fromName: 'Promo', fromEmail: 'promo@shop.fr' }),
      mail('r3', { fromName: 'Promo', fromEmail: 'promo@shop.fr' }),
      mail('s1', { fromEmail: 'moi@x.fr', to: '"Sophie Martin" <sophie@x.fr>', cc: 'Thomas <thomas@x.fr>', labelIds: ['SENT'] }),
    ]);
    const all = a.contacts('', 10, 'moi@x.fr');
    expect(all[0]).toMatchObject({ email: 'sophie@x.fr', name: 'Sophie Martin' });
    expect(all.map((c) => c.email)).not.toContain('moi@x.fr');
    expect(a.contacts('thom', 10, 'moi@x.fr').map((c) => c.email)).toEqual(['thomas@x.fr']);
  });

  it('returns a full archived mail and recent exchanges with a contact', () => {
    const { a } = setup();
    a.add([mail('m1', { fromEmail: 'sophie@x.fr', text: 'corps complet' }), mail('s1', { fromEmail: 'moi@x.fr', to: 'sophie@x.fr', labelIds: ['SENT'] })]);
    expect(a.get('m1')?.text).toBe('corps complet');
    expect(a.withContact('sophie@x.fr', 5).map((m) => m.id).sort()).toEqual(['m1', 's1']);
  });
});
