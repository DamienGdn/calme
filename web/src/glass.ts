/**
 * Liquid glass refraction for the phone menu bar. A displacement map shaped like the bar (a capsule) makes its rim
 * look inwards like a lens. It is applied with `filter: url(#calme-glass)` to a layer that carries the blurred
 * backdrop, so the refraction bends the backdrop itself. Strength, blur and tint are per-device settings.
 */

/** RGBA pixels of the map: R/G = x/y displacement (128 = none), strongest at the rim, pointing inwards. */
export function displacementMap(w: number, h: number, radius: number, bezel: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(radius, w / 2, h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const qx = Math.abs(dx) - (w / 2 - r);
      const qy = Math.abs(dy) - (h / 2 - r);
      // Distance to the capsule's edge, positive inside.
      const inside = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1;
        nx = (Math.sign(dx) * qx) / l;
        ny = (Math.sign(dy) * qy) / l;
      } else if (qx > qy) nx = Math.sign(dx);
      else ny = Math.sign(dy);
      const t = inside <= 0 ? 0 : Math.max(0, 1 - inside / bezel);
      const k = t * t * (3 - 2 * t);
      const i = (y * w + x) * 4;
      px[i] = 128 - nx * k * 127;
      px[i + 1] = 128 - ny * k * 127;
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** The map as a PNG data URL, for the SVG filter's feImage. */
export function mapUrl(w: number, h: number, radius: number, bezel: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(displacementMap(w, h, radius, bezel) as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c.toDataURL();
}
