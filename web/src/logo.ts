/**
 * Calm's mark: a big italic « c » (Fraunces Italic 500, outline taken from the font, SIL Open Font License) and a
 * round seal half its height, with a small envelope inside. Drawn in a 512 × 512 square; shared by the icon
 * generator (scripts/icons.mjs) and the logo shown in the app.
 */
export const C_PATH = 'M230.3 146.0L230.3 146.0Q217.0 146.0 203.0 158.6Q188.9 171.2 177.9 194.0Q166.8 216.7 162.7 247.1L162.7 247.1Q156.5 291.2 168.1 312.1Q179.6 333.1 204.9 333.1L204.9 333.1Q217.2 333.1 229.0 327.6Q240.8 322.1 251.2 310.6Q261.5 299.0 268.9 280.9L268.9 280.9Q269.6 279.5 270.2 278.9Q270.8 278.3 271.5 278.6L271.5 278.6Q272.5 278.6 272.8 279.6Q273.2 280.7 272.5 282.4L272.5 282.4Q265.8 301.2 255.6 315.6Q245.3 330.0 232.5 339.6Q219.6 349.2 204.6 354.2Q189.6 359.2 173.4 359.2L173.4 359.2Q138.0 359.2 120.6 334.4Q103.2 309.5 110.1 262.6L110.1 262.6Q113.7 237.6 124.8 215.6Q135.8 193.6 152.1 176.8Q168.4 160.0 188.4 150.4Q208.4 140.8 229.9 140.8L229.9 140.8Q249.8 140.8 263.3 147.2Q276.7 153.6 283.3 164.3Q289.8 175.0 288.6 188.4L288.6 188.4Q287.7 200.5 281.5 206.2Q275.3 211.9 267.5 211.9L267.5 211.9Q260.1 211.9 255.0 206.9Q249.8 201.9 250.3 193.4L250.3 193.4Q250.6 186.0 252.1 180.5Q253.7 175.0 253.7 166.9L253.7 166.9Q253.7 157.9 247.7 151.9Q241.8 146.0 230.3 146.0Z';
export const SEAL = { cx: 349.3, cy: 304.7, r: 54.5 };
/** The envelope inside the seal: its outline and its flap. */
export const ENVELOPE = {
  rect: { x: 329.5, y: 291.1, w: 39.6, h: 27.2, rx: 5 },
  flap: 'M332.5 294.3 L349.3 306.7 L366.1 294.3',
  stroke: 5.9,
};
export const LIME = '#C8F03C';
export const INK = '#0D0E11';

/** The mark as an SVG document: on a lime tile (radius in the 512 square), or bare in one colour (menu bar). */
export function logoSvg(size: number, o: { radius?: number; bare?: boolean } = {}): string {
  const e = ENVELOPE;
  const env = `<rect x="${e.rect.x}" y="${e.rect.y}" width="${e.rect.w}" height="${e.rect.h}" rx="${e.rect.rx}" fill="none"/><path d="${e.flap}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (o.bare)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="96 90 320 320"><defs><mask id="m"><rect x="0" y="0" width="512" height="512" fill="#fff"/><g stroke="#000" stroke-width="${e.stroke * 1.4}">${env}</g></mask></defs><path d="${C_PATH}" fill="#000"/><circle cx="${SEAL.cx}" cy="${SEAL.cy}" r="${SEAL.r}" fill="#000" mask="url(#m)"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" rx="${o.radius ?? 0}" fill="${LIME}"/><path d="${C_PATH}" fill="${INK}"/><circle cx="${SEAL.cx}" cy="${SEAL.cy}" r="${SEAL.r}" fill="${INK}"/><g stroke="${LIME}" stroke-width="${e.stroke}">${env}</g></svg>`;
}
