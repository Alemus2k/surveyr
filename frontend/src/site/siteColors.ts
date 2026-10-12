// Colour rules shared by the plan map and the 3D view, so both always agree:
// red = dirt leaving (still above design / dug since last scan),
// blue = dirt arriving (still below design / placed since last scan),
// green = finished to grade where work was needed.

export type RGB = [number, number, number];
export type SiteColorMode = "design" | "change" | "elevation";

// earthy rather than pure primaries: they sit on shaded relief without glowing
export const CUT: RGB = [216, 88, 78];
export const FILL: RGB = [72, 136, 214];
export const ON_GRADE: RGB = [84, 168, 118];

export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Tint for a difference ``d`` (ground minus reference) in "design" or "change"
 * mode, or null to leave the base colour. ``scale`` is the difference that
 * gets full strength; ``needsWork`` says whether this spot was off design at
 * the first scan (only then does on-grade mean "finished").
 */
export function siteTint(mode: "design" | "change", d: number, deadband: number, scale: number, needsWork: boolean): { rgb: RGB; t: number } | null {
  if (!Number.isFinite(d)) return null;
  if (Math.abs(d) <= deadband) return mode === "design" && needsWork ? { rgb: ON_GRADE, t: 0.42 } : null;
  // in design mode ground above the reference is still to dig; in change mode ground that rose was placed
  const leaving = mode === "design" ? d > 0 : d < 0;
  return { rgb: leaving ? CUT : FILL, t: 0.35 + 0.6 * Math.min(1, Math.abs(d) / scale) };
}

/** Cells that were off design at the first scan (null without a design). */
export function workMask(first: Float64Array, design: Float64Array | null, tolerance: number): Uint8Array | null {
  if (!design) return null;
  return Uint8Array.from(first, (v, i) => (Math.abs(v - design[i]) > tolerance ? 1 : 0));
}

/** The difference that gets full colour strength: 98th percentile of |d|, at least 25 cm. */
export function tintScale(absDiffs: number[]): number {
  if (!absDiffs.length) return 0.25;
  absDiffs.sort((a, b) => a - b);
  return Math.max(0.25, absDiffs[Math.min(absDiffs.length - 1, Math.floor(0.98 * absDiffs.length))]);
}
