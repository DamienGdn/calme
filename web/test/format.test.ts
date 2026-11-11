import assert from 'node:assert/strict';
import { test } from 'node:test';
import { richText } from '../src/format.ts';

test('splits paragraphs on blank lines', () => {
  assert.deepEqual(
    richText('Premier.\n\nSecond.').map((p) => p.map((s) => s.text).join('')),
    ['Premier.', 'Second.'],
  );
});

test('**double stars** become bold segments, the rest stays plain text', () => {
  assert.deepEqual(richText('Signature le **19 novembre** à **11h**.'), [
    [
      { text: 'Signature le ', bold: false },
      { text: '19 novembre', bold: true },
      { text: ' à ', bold: false },
      { text: '11h', bold: true },
      { text: '.', bold: false },
    ],
  ]);
});

test('markup in the text stays text (nothing is turned into HTML)', () => {
  const [[seg]] = richText('<img src=x onerror=alert(1)>');
  assert.deepEqual(seg, { text: '<img src=x onerror=alert(1)>', bold: false });
});

test('an unpaired star is left as is', () => {
  assert.deepEqual(richText('5 * 3 = 15'), [[{ text: '5 * 3 = 15', bold: false }]]);
});
