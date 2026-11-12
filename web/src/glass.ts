/**
 * Liquid glass of the phone menu bar, after nikdelvin/liquid-glass (MIT): an SVG displacement filter used inside
 * `backdrop-filter`, so the backdrop itself bends at the rim of the bar like through a lens, each colour channel a
 * little differently (chromatic aberration). Only Chromium (Chrome, the Mac app) applies an SVG filter to the
 * backdrop; Safari (iPhone) and Firefox keep a frosted glass: blur, saturation and tint.
 */

export interface Refraction {
  /** How far the rim bends the backdrop, in px (0 = no refraction). */
  strength: number;
  /** Width of the bent rim, in px. */
  depth: number;
  /** Extra bend of the red and green channels, in px. */
  aberration: number;
  /** Blur of the backdrop, in px. */
  blur: number;
}

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s*\n\s*/g, ''))}`;

/**
 * The displacement map: neutral grey (no bend) in the middle; towards the rim, red runs along x and green along y,
 * so each edge pulls the backdrop from inside the bar. The rounded grey core, blurred by the depth, sets how wide
 * the bent rim is.
 */
function displacementMap(w: number, h: number, radius: number, depth: number): string {
  const ky = (radius / h) * 15;
  const kx = (radius / w) * 15;
  return svgUrl(`<svg height="${h}" width="${w}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <style>.mix{mix-blend-mode:screen}</style>
    <defs>
      <linearGradient id="Y" x1="0" x2="0" y1="${Math.ceil(ky)}%" y2="${Math.floor(100 - ky)}%"><stop offset="0%" stop-color="#0F0"/><stop offset="100%" stop-color="#000"/></linearGradient>
      <linearGradient id="X" x1="${Math.ceil(kx)}%" x2="${Math.floor(100 - kx)}%" y1="0" y2="0"><stop offset="0%" stop-color="#F00"/><stop offset="100%" stop-color="#000"/></linearGradient>
    </defs>
    <rect x="0" y="0" height="${h}" width="${w}" fill="#808080"/>
    <g filter="blur(2px)">
      <rect x="0" y="0" height="${h}" width="${w}" fill="#000080"/>
      <rect x="0" y="0" height="${h}" width="${w}" fill="url(#Y)" class="mix"/>
      <rect x="0" y="0" height="${h}" width="${w}" fill="url(#X)" class="mix"/>
      <rect x="${depth}" y="${depth}" height="${Math.max(0, h - 2 * depth)}" width="${Math.max(0, w - 2 * depth)}" fill="#808080" rx="${radius}" ry="${radius}" filter="blur(${depth}px)"/>
    </g>
  </svg>`);
}

/** Three displacements of the backdrop, one per colour channel, merged back with screen blends. */
function displacementFilter(w: number, h: number, radius: number, r: Refraction): string {
  const keep = (row: number) => {
    const m = Array.from({ length: 4 }, (_, i) => Array.from({ length: 5 }, (_, j) => (i === j && (i === row || i === 3) ? 1 : 0)).join(' '));
    return m.join('  ');
  };
  const pass = (scale: number, channel: number, result: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
     <feColorMatrix type="matrix" values="${keep(channel)}" result="${result}"/>`;
  return `${svgUrl(`<svg height="${h}" width="${w}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="displace" color-interpolation-filters="sRGB">
        <feImage x="0" y="0" height="${h}" width="${w}" href="${displacementMap(w, h, radius, r.depth)}" result="map"/>
        ${pass(r.strength + r.aberration * 2, 0, 'red')}
        ${pass(r.strength + r.aberration, 1, 'green')}
        ${pass(r.strength, 2, 'blue')}
        <feBlend in="red" in2="green" mode="screen"/>
        <feBlend in2="blue" mode="screen"/>
      </filter>
    </defs>
  </svg>`)}#displace`;
}

/** The `backdrop-filter` value for a bar of this size. */
export function glassBackdrop(w: number, h: number, radius: number, r: Refraction): string {
  const tail = `blur(${r.blur}px) brightness(1.1) saturate(1.5)`;
  if (r.strength <= 0 || w <= 0 || h <= 0) return tail;
  return `blur(${r.blur / 2}px) url("${displacementFilter(w, h, radius, r)}") ${tail}`;
}

/** Chromium bends the backdrop through SVG filters; WebKit (every iPhone browser) and Firefox do not. */
export const canRefract = (ua: string) => /\b(?:Chrome|Chromium)\/\d/.test(ua) && !/iPhone|iPad|iPod/.test(ua);
