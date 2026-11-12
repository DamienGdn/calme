import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickWith } from '../src/selection.ts';

const ids = ['a', 'b', 'c', 'd', 'e'];
const set = (...x: string[]) => new Set(x);

test('Cmd / Ctrl click adds or removes one mail', () => {
  assert.deepEqual([...pickWith(set('a'), ids, 'c', 'a', 'toggle')], ['a', 'c']);
  assert.deepEqual([...pickWith(set('a', 'c'), ids, 'c', 'a', 'toggle')], ['a']);
});

test('Shift click adds the whole range from the last clicked mail, either way', () => {
  assert.deepEqual([...pickWith(set('b'), ids, 'd', 'b', 'range')].sort(), ['b', 'c', 'd']);
  assert.deepEqual([...pickWith(set('d'), ids, 'a', 'd', 'range')].sort(), ['a', 'b', 'c', 'd']);
});

test('Shift click with no anchor (or one that left the list) picks just that mail', () => {
  assert.deepEqual([...pickWith(set(), ids, 'c', null, 'range')], ['c']);
  assert.deepEqual([...pickWith(set(), ids, 'c', 'zz', 'range')], ['c']);
});
