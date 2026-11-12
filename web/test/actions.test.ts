import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionKinds, fileTarget } from '../src/actions.ts';

test('Calm’s suggested action becomes the buttons that do it', () => {
  assert.deepEqual(actionKinds('se désabonner ou supprimer'), ['unsub', 'trash']);
  assert.deepEqual(actionKinds('Répondre à Sophie avant samedi'), ['reply']);
  assert.deepEqual(actionKinds('archiver'), ['archive']);
  assert.deepEqual(actionKinds('Unsubscribe or delete'), ['unsub', 'trash']);
  assert.deepEqual(actionKinds('mettre à la corbeille'), ['trash']);
  assert.deepEqual(actionKinds('y penser plus tard'), ['remind']);
  assert.deepEqual(actionKinds('lire sur EcoleDirecte'), []);
});

test('“file it in Factures” names the folder to file the mail in', () => {
  assert.equal(fileTarget('lire puis ranger dans Factures'), 'Factures');
  assert.equal(fileTarget('Classer dans le dossier « Impôts 2026 »'), 'Impôts 2026');
  assert.equal(fileTarget('déplacer vers Maison/Travaux, puis répondre'), 'Maison/Travaux');
  assert.equal(fileTarget('File it under Invoices.'), 'Invoices');
  assert.equal(fileTarget('répondre à Sophie'), null);
});
