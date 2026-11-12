import assert from 'node:assert/strict';
import { test } from 'node:test';
import { axis, sheetSwipe, swipeAction, swipeBack } from '../src/gestures.ts';

test('axis waits for a real move, then locks on the dominant direction', () => {
  assert.equal(axis(4, 3), null);
  assert.equal(axis(30, 6), 'x');
  assert.equal(axis(6, 30), 'y');
  // A diagonal drag is a scroll: the list must stay easy to scroll.
  assert.equal(axis(20, 19), 'y');
});

test('a row dragged right past a third of its width switches read / unread', () => {
  assert.equal(swipeAction(150, 360, 600), 'read');
  assert.equal(swipeAction(100, 360, 600), null);
});

test('a row dragged left past a third of its width goes to the trash', () => {
  assert.equal(swipeAction(-150, 360, 600), 'trash');
  assert.equal(swipeAction(-100, 360, 600), null);
});

test('a quick flick acts even when short, a nudge does not', () => {
  assert.equal(swipeAction(80, 360, 90), 'read');
  assert.equal(swipeAction(-80, 360, 90), 'trash');
  assert.equal(swipeAction(30, 360, 20), null);
  assert.equal(swipeAction(-30, 360, 20), null);
});

test('swiping right on an open mail goes back to the list', () => {
  assert.equal(swipeBack(130, 390, 500), true);
  assert.equal(swipeBack(60, 390, 500), false);
  assert.equal(swipeBack(70, 390, 100), true);
  assert.equal(swipeBack(-200, 390, 100), false);
});

test('a sheet pulled down past a quarter of its height, or flicked down, closes', () => {
  assert.equal(sheetSwipe(200, 600, 500), 'down');
  assert.equal(sheetSwipe(60, 600, 500), null);
  assert.equal(sheetSwipe(70, 80, 500), 'down'); // flick
  assert.equal(sheetSwipe(130, 600, 800), 'down'); // capped at 120 px on a tall sheet
});

test('a sheet pushed up, or flicked up, asks for the next step (edit an appointment)', () => {
  assert.equal(sheetSwipe(-100, 600, 500), 'up');
  assert.equal(sheetSwipe(-40, 600, 500), null);
  assert.equal(sheetSwipe(-60, 80, 500), 'up'); // flick
});
