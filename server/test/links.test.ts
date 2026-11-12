import { describe, expect, it } from 'vitest';
import { actionLink } from '../src/links.ts';

const html = `<p>Pour lire ce message, connectez-vous sur <a href="https://www.ecoledirecte.com/login?x=1">EcoleDirecte</a>.</p>
<a href="https://news.example.fr/unsubscribe?u=1">Se désabonner</a> <a href="javascript:alert(1)">EcoleDirecte</a> <a href="mailto:a@b.fr">écrire</a>`;

describe('actionLink', () => {
  it('finds the mail’s own link that matches what Calm says to do', () => {
    expect(actionLink('lire sur EcoleDirecte rapidement', html, '')).toEqual({ url: 'https://www.ecoledirecte.com/login?x=1', label: 'EcoleDirecte', host: 'ecoledirecte.com' });
  });
  it('also looks at links written in the text, by their site', () => {
    expect(actionLink('Payer la facture sur Ameli', '', 'Rendez-vous sur https://www.ameli.fr/assure/compte pour payer.')).toMatchObject({ url: 'https://www.ameli.fr/assure/compte', host: 'ameli.fr' });
  });
  it('gives nothing when no link fits, and never an unsubscribe, script or mail link', () => {
    expect(actionLink('répondre à Sophie', html, '')).toBeNull();
    expect(actionLink('se désabonner', html, '')).toBeNull();
    expect(actionLink('', html, '')).toBeNull();
  });
});
