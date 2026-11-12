import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRefract, glassBackdrop } from '../src/glass.ts';

const opts = { strength: 100, depth: 10, aberration: 3, blur: 4 };
/** The SVG filter inside the backdrop-filter value, decoded. */
const filterOf = (css: string) => decodeURIComponent(/url\("data:image\/svg\+xml;utf8,([^"]+)#displace"\)/.exec(css)![1]);

test('the backdrop blurs a little, bends through the SVG filter, blurs again, then brightens and saturates', () => {
  const css = glassBackdrop(300, 64, 32, opts);
  assert.match(css, /^blur\(2px\) url\("data:image\/svg\+xml;utf8,[^"]+#displace"\) blur\(4px\) brightness\(1\.1\) saturate\(1\.5\)$/);
});

test('chromatic aberration: red bends most, then green, then blue', () => {
  const svg = filterOf(glassBackdrop(300, 64, 32, opts));
  const scales = [...svg.matchAll(/feDisplacementMap[^>]*scale="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(scales, [106, 103, 100]);
  assert.equal((svg.match(/feBlend[^>]*mode="screen"/g) ?? []).length, 2);
});

test('the displacement map is the size of the bar, with a rounded core blurred by the depth', () => {
  const svg = filterOf(glassBackdrop(300, 64, 32, opts));
  const map = decodeURIComponent(/href="data:image\/svg\+xml;utf8,([^"]+)"/.exec(svg)![1]);
  assert.match(map, /width="300"/);
  assert.match(map, /height="64"/);
  assert.match(map, /<rect x="10" y="10" height="44" width="280" fill="#808080" rx="32" ry="32" filter="blur\(10px\)"/);
});

test('no refraction: a plain blur', () => {
  assert.equal(glassBackdrop(300, 64, 32, { ...opts, strength: 0 }), 'blur(4px) brightness(1.1) saturate(1.5)');
});

test('only Chromium bends the backdrop; Safari and Firefox keep the frosted glass', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const crios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
  const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const electron = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Calm/0.6.0 Chrome/130.0 Electron/33.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0';
  assert.equal(canRefract(iphone), false);
  assert.equal(canRefract(crios), false);
  assert.equal(canRefract(firefox), false);
  assert.equal(canRefract(chrome), true);
  assert.equal(canRefract(electron), true);
});
