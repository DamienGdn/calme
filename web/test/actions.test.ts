import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionKinds } from '../src/actions.ts';

test('Calm’s suggested action becomes the buttons that do it', () => {
  assert.deepEqual(actionKinds('se désabonner ou supprimer'), ['unsub', 'trash']);
  assert.deepEqual(actionKinds('Répondre à Sophie avant samedi'), ['reply']);
  assert.deepEqual(actionKinds('archiver'), ['archive']);
  assert.deepEqual(actionKinds('Unsubscribe or delete'), ['unsub', 'trash']);
  assert.deepEqual(actionKinds('mettre à la corbeille'), ['trash']);
  assert.deepEqual(actionKinds('y penser plus tard'), ['remind']);
  assert.deepEqual(actionKinds('lire sur EcoleDirecte'), []);
});
