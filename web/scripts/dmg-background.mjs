// macOS installer window background (desktop/build/background.png + @2x), 540×380 points.
import sharp from 'sharp';

const W = 540;
const H = 380;
const dots = [];
for (let x = 11; x < W; x += 22) for (let y = 11; y < H; y += 22) dots.push(`<circle cx="${x}" cy="${y}" r="0.8" fill="#ffffff" fill-opacity="0.07"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0D0E11"/>
  ${dots.join('')}
  <text x="40" y="70" font-family="Georgia, 'Times New Roman', serif" font-size="42" letter-spacing="-1" fill="#EDEBE5">Calm<tspan fill="#C8F03C">.</tspan></text>
  <text x="42" y="98" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="14" fill="#9C9BA3">Your Gmail, sorted by AI. <tspan fill="#FF9152">Without the noise.</tspan></text>
  <g transform="translate(368 44)">
    <rect width="138" height="26" rx="13" fill="none" stroke="#C8F03C" stroke-width="1.2"/>
    <circle cx="14" cy="13" r="3.5" fill="#C8F03C"/>
    <text x="24" y="17.5" font-family="Menlo, Monaco, monospace" font-size="9.5" letter-spacing="0.6" fill="#C8F03C">POWERED BY CLAUDE</text>
  </g>
  <path d="M206 222 H322" stroke="#C8F03C" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 7"/>
  <path d="M314 212 L326 222 L314 232" fill="none" stroke="#C8F03C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="270" y="330" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="12" fill="#9C9BA3">Drag Calm to Applications · Glisse Calm dans Applications</text>
</svg>`;

for (const [file, scale] of [['../desktop/build/background.png', 1], ['../desktop/build/background@2x.png', 2]])
  await sharp(Buffer.from(svg), { density: 72 * scale }).resize(W * scale, H * scale).png().toFile(file);
console.log('dmg background ok');
