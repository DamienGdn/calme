import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axis, swipeBack, swipeTrashes } from '../src/gestures.ts';

test('axis waits for a real move, then locks on the dominant direction', () => {
  assert.equal(axis(4, 3), null);
  assert.equal(axis(30, 6), 'x');
  assert.equal(axis(6, 30), 'y');
  // A diagonal drag is a scroll: the list must stay easy to scroll.
  assert.equal(axis(20, 19), 'y');
});

test('a row is trashed when dragged right past a third of its width', () => {
  assert.equal(swipeTrashes(150, 360, 600), true);
  assert.equal(swipeTrashes(100, 360, 600), false);
});

test('a quick flick to the right trashes even when short', () => {
  assert.equal(swipeTrashes(80, 360, 90), true);
  assert.equal(swipeTrashes(30, 360, 20), false);
});

test('dragging to the left never trashes', () => {
  assert.equal(swipeTrashes(-300, 360, 100), false);
});

test('swiping right on an open mail goes back to the list', () => {
  assert.equal(swipeBack(130, 390, 500), true);
  assert.equal(swipeBack(60, 390, 500), false);
  assert.equal(swipeBack(70, 390, 100), true);
  assert.equal(swipeBack(-200, 390, 100), false);
});
