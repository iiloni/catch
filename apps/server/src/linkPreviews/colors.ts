/**
 * A site's color, reduced to an OKLCH hue. The client pairs it with one lightness and
 * chroma per theme (as note colors do), so a neon brand color and a muted one read the
 * same and text contrast holds. Colors too gray to have a meaningful hue give null.
 */

type Rgb = [number, number, number];

/** Below this OKLCH chroma a color reads as gray; its hue is noise. */
const MIN_CHROMA = 0.045;

function linear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB (0-255) to OKLCH lightness, chroma and hue in degrees. */
export function toOklch([r, g, b]: Rgb): { l: number; c: number; h: number } {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: (h + 360) % 360 };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parses the CSS colors sites put in `theme-color`: hex, rgb() and hsl(). */
export function parseCssColor(value: string): Rgb | null {
  const color = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(color)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      return [0, 1, 2].map((i) => Number.parseInt(hex.charAt(i).repeat(2), 16)) as Rgb;
    }
    if (hex.length === 6 || hex.length === 8) {
      return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
    }
    return null;
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(color);
  if (!fn?.[1] || fn[2] === undefined) return null;
  const parts = fn[2]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => ({ value: Number.parseFloat(part), percent: part.endsWith('%') }));
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part.value))) return null;
  const [first, second, third] = parts as [(typeof parts)[0], (typeof parts)[0], (typeof parts)[0]];
  if (fn[1].startsWith('rgb')) {
    return [first, second, third].map((part) =>
      Math.max(0, Math.min(255, part.percent ? part.value * 2.55 : part.value)),
    ) as Rgb;
  }
  return hslToRgb(
    ((first.value % 360) + 360) % 360,
    Math.max(0, Math.min(1, second.value / 100)),
    Math.max(0, Math.min(1, third.value / 100)),
  );
}

/** The hue of a single color, or null when it is too close to gray. */
export function colorHue(rgb: Rgb): number | null {
  const { c, h } = toOklch(rgb);
  return c < MIN_CHROMA ? null : Math.round(h) % 360;
}

/**
 * The hue that dominates an image, from raw RGBA pixels. Pixels are binned by hue and
 * weighted by chroma, so a logo's color wins over its white or black background. Null when
 * too little of the image is colorful, as with monochrome logos.
 */
export function dominantHue(pixels: Uint8Array | Buffer): number | null {
  const BINS = 36;
  const weights = new Float64Array(BINS);
  const sin = new Float64Array(BINS);
  const cos = new Float64Array(BINS);
  let opaque = 0;
  let colorful = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0;
    if (alpha < 128) continue;
    opaque += 1;
    const { c, h } = toOklch([pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0]);
    if (c < MIN_CHROMA) continue;
    colorful += 1;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    const radians = (h * Math.PI) / 180;
    weights[bin] = (weights[bin] ?? 0) + c;
    sin[bin] = (sin[bin] ?? 0) + Math.sin(radians) * c;
    cos[bin] = (cos[bin] ?? 0) + Math.cos(radians) * c;
  }
  if (opaque === 0 || colorful / opaque < 0.08) return null;

  // Neighboring bins count together, so a hue split across a bin edge still wins.
  let best = 0;
  let bestWeight = -1;
  for (let bin = 0; bin < BINS; bin += 1) {
    const weight =
      (weights[(bin + BINS - 1) % BINS] ?? 0) +
      (weights[bin] ?? 0) +
      (weights[(bin + 1) % BINS] ?? 0);
    if (weight > bestWeight) {
      best = bin;
      bestWeight = weight;
    }
  }
  let x = 0;
  let y = 0;
  for (const bin of [(best + BINS - 1) % BINS, best, (best + 1) % BINS]) {
    x += cos[bin] ?? 0;
    y += sin[bin] ?? 0;
  }
  const hue = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((hue + 360) % 360) % 360;
}
