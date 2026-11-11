// Generates app icons (PWA, Apple touch, desktop tray) from one SVG.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const svg = (size, radius) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="#C8F03C"/>
  <text x="250" y="345" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="330" fill="#0D0E11">c.</text>
</svg>`);

// macOS menu bar "template" icon: black glyph on transparent, recoloured by the system for light/dark menu bars.
const template = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 22 22">
  <text x="10.5" y="17" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="bold" font-size="20" fill="#000">c.</text>
</svg>`);

const out = [
  ['public/icon-192.png', 192, 96],
  ['public/icon-512.png', 512, 96],
  ['public/apple-touch-icon.png', 180, 0],
  ['public/favicon.png', 64, 112],
  ['../desktop/build/icon.png', 1024, 112],
  ['../desktop/build/tray.png', 32, 112],
  ['../desktop/build/tray@2x.png', 64, 112],
];
mkdirSync('../desktop/build', { recursive: true });
for (const [file, size, radius] of out) await sharp(svg(size, radius)).resize(size, size).png().toFile(file);
for (const [file, size] of [['../desktop/build/trayTemplate.png', 22], ['../desktop/build/trayTemplate@2x.png', 44]])
  await sharp(template(size), { density: 72 * (size / 22) }).resize(size, size).png().toFile(file);
console.log('icons ok');
