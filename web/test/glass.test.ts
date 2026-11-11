import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displacementMap } from '../src/glass.ts';

const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => [px[(y * w + x) * 4], px[(y * w + x) * 4 + 1]];

test('the middle of the bar is not bent', () => {
  const px = displacementMap(200, 60, 30, 16);
  assert.deepEqual(at(px, 200, 100, 30), [128, 128]);
});

test('the rim looks inwards like a lens: the left edge shows what is to its right, the bottom edge what is above', () => {
  const px = displacementMap(200, 60, 30, 16);
  const [lx] = at(px, 200, 0, 30);
  const [, by] = at(px, 200, 100, 59);
  assert.ok(lx > 200, `left rim x displacement ${lx}`);
  assert.ok(by < 60, `bottom rim y displacement ${by}`);
});

test('the bend fades to nothing past the bezel', () => {
  const px = displacementMap(200, 60, 30, 10);
  assert.deepEqual(at(px, 200, 100, 15), [128, 128]);
});
