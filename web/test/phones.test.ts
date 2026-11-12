import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPhones } from '../src/phones.ts';

const tels = (s: string) => findPhones(s).map((p) => [p.raw, p.tel]);

test('French numbers, written the usual ways', () => {
  assert.deepEqual(tels('Appelez le 01 23 45 67 89 ou le 06.12.34.56.78.'), [['01 23 45 67 89', 'tel:0123456789'], ['06.12.34.56.78', 'tel:0612345678']]);
  assert.deepEqual(tels('Tél : +33 6 12 34 56 78'), [['+33 6 12 34 56 78', 'tel:+33612345678']]);
  assert.deepEqual(tels('Standard +33 (0)1 23 45 67 89'), [['+33 (0)1 23 45 67 89', 'tel:+33123456789']]);
  assert.deepEqual(tels('Mon 0612345678 perso'), [['0612345678', 'tel:0612345678']]);
});

test('international numbers', () => {
  assert.deepEqual(tels('London: +44 20 7946 0958'), [['+44 20 7946 0958', 'tel:+442079460958']]);
});

test('not dates, amounts, references or long codes', () => {
  assert.deepEqual(tels('Le 10.11.2026 à 12:30, facture F717A033559 de 1 234,56 €, commande 123456789012345, code 4521.'), []);
});

test('positions let the text be cut around each number', () => {
  const s = 'Tel 01 23 45 67 89.';
  const [p] = findPhones(s);
  assert.equal(s.slice(p.start, p.end), '01 23 45 67 89');
});
