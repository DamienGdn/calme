import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMode } from '../src/install.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15';
const MAC_SAFARI = IPAD;
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const base = { touchPoints: 0, standalone: false, desktopApp: false, canPrompt: false };

test('the install button says how to add Calm where the browser cannot do it by itself', () => {
  assert.equal(installMode({ ...base, ua: IPHONE, touchPoints: 5 }), 'ios');
  assert.equal(installMode({ ...base, ua: IPAD, touchPoints: 5 }), 'ios'); // iPadOS reads as a Mac
  assert.equal(installMode({ ...base, ua: MAC_SAFARI }), 'mac-safari');
  assert.equal(installMode({ ...base, ua: MAC_CHROME, canPrompt: true }), 'prompt');
});

test('no install button once installed, in the desktop app, or where nothing can install it', () => {
  assert.equal(installMode({ ...base, ua: IPHONE, touchPoints: 5, standalone: true }), null);
  assert.equal(installMode({ ...base, ua: MAC_CHROME, canPrompt: true, desktopApp: true }), null);
  assert.equal(installMode({ ...base, ua: MAC_CHROME }), null);
});
