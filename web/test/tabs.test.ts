import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeTab, cycleTab, emptyTabs, MAX_TABS, openTab, pruneTabs, toggleCompare } from '../src/tabLogic.ts';

const s = (ids: string[], active: string | null, extra: Partial<ReturnType<typeof emptyTabs>> = {}) => ({ ...emptyTabs(), ids, active, ...extra });

test('a plain open replaces the active tab in place', () => {
  const r = openTab(s(['a', 'b', 'c'], 'b'), 'x');
  assert.deepEqual(r.ids, ['a', 'x', 'c']);
  assert.equal(r.active, 'x');
});

test('a plain open with no tab creates the first one', () => {
  const r = openTab(emptyTabs(), 'a');
  assert.deepEqual(r.ids, ['a']);
  assert.equal(r.active, 'a');
});

test('opening a mail that is already open just activates its tab', () => {
  const r = openTab(s(['a', 'b'], 'a'), 'b');
  assert.deepEqual(r.ids, ['a', 'b']);
  assert.equal(r.active, 'b');
  assert.equal(r.prev, 'a');
});

test('a background open adds a last tab, in click order, without switching', () => {
  const r = openTab(openTab(s(['a', 'b'], 'a'), 'x', true), 'y', true);
  assert.deepEqual(r.ids, ['a', 'b', 'x', 'y']);
  assert.equal(r.active, 'a');
});

test('tabs are capped, dropping the oldest tab that is neither shown nor compared', () => {
  const ids = Array.from({ length: MAX_TABS }, (_, i) => `m${i}`);
  const r = openTab(s(ids, 'm0', { compare: 'm1' }), 'new', true);
  assert.equal(r.ids.length, MAX_TABS);
  assert.ok(r.ids.includes('m0') && r.ids.includes('m1') && r.ids.includes('new'));
  assert.ok(!r.ids.includes('m2'));
});

test('opening the compared mail swaps the two panes', () => {
  const r = openTab(s(['a', 'b'], 'a', { compare: 'b' }), 'b');
  assert.equal(r.active, 'b');
  assert.equal(r.compare, 'a');
});

test('replacing the active tab in place keeps an unrelated comparison', () => {
  const r = openTab(s(['a', 'b'], 'a', { compare: 'b' }), 'x');
  assert.deepEqual(r.ids, ['x', 'b']);
  assert.equal(r.compare, 'b');
});

test('closing the active tab moves to its right neighbour, else the left one', () => {
  assert.equal(closeTab(s(['a', 'b', 'c'], 'b'), 'b').active, 'c');
  assert.equal(closeTab(s(['a', 'b', 'c'], 'c'), 'c').active, 'b');
  assert.equal(closeTab(s(['a'], 'a'), 'a').active, null);
});

test('closing a tab that takes part in the comparison ends it', () => {
  assert.equal(closeTab(s(['a', 'b', 'c'], 'a', { compare: 'b' }), 'b').compare, null);
  const r = closeTab(s(['a', 'b'], 'a', { compare: 'b' }), 'a');
  assert.equal(r.active, 'b');
  assert.equal(r.compare, null);
});

test('closing a background tab keeps the active one', () => {
  const r = closeTab(s(['a', 'b', 'c'], 'a'), 'c');
  assert.deepEqual(r.ids, ['a', 'b']);
  assert.equal(r.active, 'a');
});

test('cycling wraps around in both directions', () => {
  assert.equal(cycleTab(s(['a', 'b', 'c'], 'c'), 1).active, 'a');
  assert.equal(cycleTab(s(['a', 'b', 'c'], 'a'), -1).active, 'c');
  assert.equal(cycleTab(s(['a'], 'a'), 1).active, 'a');
});

test('cycling onto the compared tab swaps the two panes', () => {
  const r = cycleTab(s(['a', 'b', 'c'], 'a', { compare: 'b' }), 1);
  assert.equal(r.active, 'b');
  assert.equal(r.compare, 'a');
});

test('compare pairs the active tab with the previously shown one, else a neighbour', () => {
  assert.equal(toggleCompare(s(['a', 'b', 'c'], 'c', { prev: 'a' })).compare, 'a');
  assert.equal(toggleCompare(s(['a', 'b', 'c'], 'b', { prev: 'zz' })).compare, 'c');
  assert.equal(toggleCompare(s(['a', 'b'], 'b')).compare, 'a');
  assert.equal(toggleCompare(s(['a'], 'a')).compare, null);
  assert.equal(toggleCompare(s(['a', 'b'], 'a', { compare: 'b' })).compare, null);
});

test('pruning drops tabs of mails that left the inbox and repairs active and compare', () => {
  const r = pruneTabs(s(['a', 'b', 'c'], 'b', { compare: 'c', prev: 'a' }), new Set(['a', 'c']));
  assert.deepEqual(r.ids, ['a', 'c']);
  assert.equal(r.active, 'c');
  assert.equal(r.compare, null);
});

test('pruning returns the same object when nothing changed', () => {
  const st = s(['a'], 'a');
  assert.equal(pruneTabs(st, new Set(['a', 'b'])), st);
});
