import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directionsUrl, mapsUrl } from '../src/maps.ts';

test('a place opens in Apple Plans, pinned on its coordinates when known', () => {
  assert.equal(mapsUrl('Leroy Merlin, Rue de la Maison Neuve, 35830 Betton', { lat: 48.1644, lon: -1.6328 }), 'https://maps.apple.com/?q=Leroy+Merlin%2C+Rue+de+la+Maison+Neuve%2C+35830+Betton&ll=48.1644%2C-1.6328');
  assert.equal(mapsUrl('10 Rue de Rivoli 75004 Paris'), 'https://maps.apple.com/?q=10+Rue+de+Rivoli+75004+Paris');
  assert.equal(mapsUrl('  '), '');
});

test('the route to a place opens in Apple Plans, by car from where you are', () => {
  assert.equal(directionsUrl('Leroy Merlin, 35830 Betton'), 'https://maps.apple.com/?daddr=Leroy+Merlin%2C+35830+Betton&dirflg=d');
});
