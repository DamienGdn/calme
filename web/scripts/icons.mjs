// Generates app icons (PWA, Apple touch, favicon, desktop app and menu bar) from Calm's mark (src/logo.ts).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { logoSvg } from '../src/logo.ts';

const svg = (size, radius) => Buffer.from(logoSvg(size, { radius }));
// macOS menu bar "template" icon: black mark on transparent, recoloured by the system for light/dark menu bars.
const template = (size) => Buffer.from(logoSvg(size, { bare: true }));

const out = [
  ['public/icon-192.png', 192, 96],
  ['public/icon-512.png', 512, 96],
  // iOS rounds the home-screen icon itself: a full square.
  ['public/apple-touch-icon.png', 180, 0],
  ['public/favicon.png', 64, 112],
  ['../desktop/build/icon.png', 1024, 112],
  ['../desktop/build/tray.png', 32, 112],
  ['../desktop/build/tray@2x.png', 64, 112],
];
mkdirSync('../desktop/build', { recursive: true });
for (const [file, size, radius] of out) await sharp(svg(size, radius), { density: 72 * (size / 512) * 4 }).resize(size, size).png().toFile(file);
for (const [file, size] of [['../desktop/build/trayTemplate.png', 22], ['../desktop/build/trayTemplate@2x.png', 44]])
  await sharp(template(size), { density: 72 * 4 }).resize(size, size).png().toFile(file);
console.log('icons ok');
