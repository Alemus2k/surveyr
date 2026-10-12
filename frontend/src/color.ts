// Color helpers. RGB returned in 0..255 for canvas, or 0..1 floats for Three.js.

export type RGB255 = [number, number, number];
export type RGB01 = [number, number, number];

/** Terrain-style color ramp: deep blue (low) -> green -> yellow -> red (high). */
export function terrainRamp(t: number): RGB255 {
  t = Math.max(0, Math.min(1, t));
  // stops: 0 blue, .35 green, .65 yellow, 1 red
  const stops: Array<[number, RGB255]> = [
    [0.0, [40, 80, 200]],
    [0.35, [40, 170, 90]],
    [0.65, [230, 210, 60]],
    [1.0, [220, 60, 50]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** Normalize a value to 0..1 (clamped) between lo and hi. */
export function normalize(v: number, lo: number, hi: number): number {
  if (hi === lo) return 0;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}
/**
 * Elevation ramp: Turbo (Google's perceptually smoothed jet), blue (low) ->
 * cyan -> green -> yellow -> red (high). It keeps the reading surveyors expect
 * from scanner software without jet's harsh cyan/yellow bands. The near-black
 * ends are trimmed so the lowest and highest points stay visible on the dark
 * viewport.
 */
const TURBO_LO = 0.07;
const TURBO_HI = 0.95;

function turbo(x: number): RGB255 {
  // Mikhailov's polynomial fit of Turbo (Apache-2.0), x in 0..1
  const r = 0.13572138 + x * (4.6153926 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
  const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
  const b = 0.1066733 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
  const c = (v: number) => Math.round(255 * Math.max(0, Math.min(1, v)));
  return [c(r), c(g), c(b)];
}

export function elevationRamp(t: number): RGB255 {
  t = Math.max(0, Math.min(1, t));
  return turbo(TURBO_LO + t * (TURBO_HI - TURBO_LO));
}

/** CSS linear-gradient (bottom -> top) matching elevationRamp, for legends. */
export function elevationCssGradient(): string {
  const stops = Array.from({ length: 11 }, (_, i) => {
    const [r, g, b] = elevationRamp(i / 10);
    return `rgb(${r},${g},${b}) ${i * 10}%`;
  });
  return `linear-gradient(to top, ${stops.join(", ")})`;
}
