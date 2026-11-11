// Renders the README banner (docs/assets/banner.png) from an SVG.
import sharp from 'sharp';

const W = 1280;
const H = 420;
const dots = [];
for (let x = 11; x < W; x += 22) for (let y = 11; y < H; y += 22) dots.push(`<circle cx="${x}" cy="${y}" r="1" fill="#ffffff" fill-opacity="0.06"/>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0D0E11"/>
  ${dots.join('')}
  <rect x="96" y="118" width="184" height="184" rx="42" fill="#C8F03C"/>
  <text x="184" y="252" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="124" fill="#0D0E11">c.</text>
  <text x="328" y="214" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="112" fill="#EDEBE5">Calme</text>
  <text x="332" y="270" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="27" fill="#9C9BA3">Your Gmail, sorted by AI. <tspan fill="#FF9152">Without the noise.</tspan></text>
  <g transform="translate(332 300)">
    <rect width="250" height="42" rx="21" fill="none" stroke="#C8F03C" stroke-width="2"/>
    <circle cx="24" cy="21" r="6" fill="#C8F03C"/>
    <text x="40" y="28" font-family="Menlo, Monaco, monospace" font-size="17" letter-spacing="1" fill="#C8F03C">POWERED BY CLAUDE</text>
  </g>
  <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="15" font-weight="bold" fill="#0D0E11">
    <rect x="1010" y="128" width="210" height="46" rx="12" fill="#FF7A2F"/><text x="1028" y="157">5 · To answer</text>
    <rect x="1010" y="182" width="180" height="46" rx="12" fill="#E4E1D8"/><text x="1028" y="211">9 · To read</text>
    <rect x="1010" y="236" width="160" height="46" rx="12" fill="#8F8BB4"/><text x="1028" y="265">34 · Newsletters</text>
    <rect x="1010" y="290" width="120" height="46" rx="12" fill="#34353C"/><text x="1028" y="319" fill="#EDEBE5">70 · Delete</text>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('../docs/assets/banner.png');
console.log('banner ok');
