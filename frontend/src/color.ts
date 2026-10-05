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
/** Scanner-style "jet" ramp: blue (low) -> cyan -> green -> yellow -> red (high). */
export const JET_STOPS: Array<[number, RGB255]> = [
  [0.0, [20, 40, 255]],
  [0.25, [0, 220, 255]],
  [0.5, [40, 255, 60]],
  [0.75, [255, 240, 0]],
  [1.0, [255, 30, 10]],
];

export function jetRamp(t: number): RGB255 {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < JET_STOPS.length - 1; i++) {
    const [t0, c0] = JET_STOPS[i];
    const [t1, c1] = JET_STOPS[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return JET_STOPS[JET_STOPS.length - 1][1];
}

/** CSS linear-gradient (bottom -> top) matching jetRamp, for legends. */
export function jetCssGradient(): string {
  const stops = JET_STOPS.map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${t * 100}%`);
  return `linear-gradient(to top, ${stops.join(", ")})`;
}
