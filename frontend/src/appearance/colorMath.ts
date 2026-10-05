// Colour conversions and WCAG contrast helpers for user-chosen highlight colours.

export interface Rgb {
  r: number; // 0..255
  g: number;
  b: number;
}

/** Hue 0..360, saturation and value 0..1 — the colour wheel's coordinates. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Normalise "#F80", "f80", "#ff8800" → "#ff8800"; null if not a hex colour. */
export function parseHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${hex.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = parseInt((parseHex(hex) ?? "#000000").slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + ((h % 360) + 360) % 360 / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex({ r: f(5) * 255, g: f(3) * 255, b: f(1) * 255 });
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const { h, s: sv, v } = hexToHsv(rgbToHex({ r, g, b }));
  const l = v * (1 - sv / 2);
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToHex({ h, s: v === 0 ? 0 : 2 * (1 - l / v), v });
}

/** WCAG relative luminance (0 black … 1 white). */
function luminance(hex: string): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on ``bg``. */
export function readableInk(bg: string): string {
  return contrastRatio(bg, "#000000") >= contrastRatio(bg, "#ffffff") ? "#000000" : "#ffffff";
}

const LIGHTNESS_STEP = 0.01;

/**
 * Nudge ``color``'s lightness (keeping its hue) away from ``bg`` until the two
 * reach ``minRatio``. Colours that already pass are returned unchanged.
 */
export function ensureContrast(color: string, bg: string, minRatio: number): string {
  if (contrastRatio(color, bg) >= minRatio) return color;
  const hsl = rgbToHsl(hexToRgb(color));
  const darken = luminance(bg) > 0.5;
  for (let l = hsl.l; l >= 0 && l <= 1; l += darken ? -LIGHTNESS_STEP : LIGHTNESS_STEP) {
    const candidate = hslToHex({ ...hsl, l: clamp01(l) });
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return darken ? "#000000" : "#ffffff";
}

/** "rgba(r, g, b, a)" for translucent fills and outlines. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
