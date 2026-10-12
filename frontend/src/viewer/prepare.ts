import { elevationRamp, normalize } from "../color";
import type { SceneBox } from "./backdrop";

/** Survey-space point that packed float32 coordinates are relative to. */
export interface Origin {
  x: number;
  y: number;
  z: number;
}

export const ZERO_ORIGIN: Origin = { x: 0, y: 0, z: 0 };

/** Elevation window mapped onto the colour ramp (metres). */
export interface ColorRange {
  min: number;
  max: number;
}

/** Scene-ready geometry plus the raw elevations the panels need. */
export interface PreparedCloud {
  count: number;
  /** Survey point mapped to the scene origin: scene = ((x-ox), (z-oz)·exag, -(y-oy)). */
  origin: { x: number; y: number; z: number };
  positions: Float32Array; // scene coords: x east, y up (exaggerated), z = -north; centred
  z: Float32Array; // raw elevations (m), same order as positions
  zMin: number;
  zMax: number;
  defaultRange: ColorRange; // 1st..99th percentile
  box: SceneBox;
  span: number;
  exaggeration: number;
}

const COLOR_LO_PCT = 0.01; // clip default colour range to 1st..99th percentile so
const COLOR_HI_PCT = 0.99; // a few stray points don't wash out the ramp
const MAX_EXAGGERATION = 3;
const TARGET_RELIEF_RATIO = 0.1; // stretch flat sites until relief ~10% of span

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/**
 * Convert packed x,y,z (Z up, metres, relative to ``base``) into centred
 * Three.js coordinates (Y up, north = -Z). Vertical exaggeration only applies to sites that are flat
 * relative to their footprint, so small scans keep true proportions.
 */
export function prepareCloud(xyz: Float32Array, base: Origin = ZERO_ORIGIN): PreparedCloud {
  const count = Math.floor(xyz.length / 3);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3], y = xyz[i * 3 + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    z[i] = xyz[i * 3 + 2] + base.z; // true elevation (small numbers: float32 is fine)
  }
  const sorted = z.slice().sort();
  const zMin = count ? sorted[0] : 0;
  const zMax = count ? sorted[count - 1] : 0;

  const span = count ? Math.max(x1 - x0, y1 - y0, 1e-6) : 1;
  const relief = Math.max(zMax - zMin, 1e-6);
  const exaggeration = Math.min(MAX_EXAGGERATION, Math.max(1, (TARGET_RELIEF_RATIO * span) / relief));

  const cx = count ? (x0 + x1) / 2 : 0;
  const cy = count ? (y0 + y1) / 2 : 0;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = xyz[i * 3] - cx;
    positions[i * 3 + 1] = (z[i] - zMin) * exaggeration;
    positions[i * 3 + 2] = -(xyz[i * 3 + 1] - cy);
  }

  return {
    count,
    origin: { x: base.x + cx, y: base.y + cy, z: zMin }, // added in double precision
    positions,
    z,
    zMin,
    zMax,
    defaultRange: {
      min: count ? percentile(sorted, COLOR_LO_PCT) : 0,
      max: count ? percentile(sorted, COLOR_HI_PCT) : 1,
    },
    box: count ? { halfX: (x1 - x0) / 2, halfZ: (y1 - y0) / 2, height: relief * exaggeration } : { halfX: 0.5, halfZ: 0.5, height: 0 },
    span,
    exaggeration,
  };
}

/** Per-point RGB (0..1) on the elevation ramp for the given elevation window. */
export function colorize(z: Float32Array, range: ColorRange): Float32Array {
  const rgb = new Float32Array(z.length * 3);
  for (let i = 0; i < z.length; i++) {
    const [r, g, b] = elevationRamp(normalize(z[i], range.min, range.max));
    rgb[i * 3] = r / 255;
    rgb[i * 3 + 1] = g / 255;
    rgb[i * 3 + 2] = b / 255;
  }
  return rgb;
}

/** Point counts per equal-width elevation bin between min and max (inclusive). */
export function elevationHistogram(z: Float32Array, bins: number, min: number, max: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  const width = (max - min) / bins || 1;
  for (let i = 0; i < z.length; i++) {
    const b = Math.floor((z[i] - min) / width);
    counts[Math.max(0, Math.min(bins - 1, b))]++;
  }
  return counts;
}

/** Survey → scene coordinates for this cloud's frame (used for surfaces). */
export function cloudToScene(cloud: PreparedCloud) {
  const { x: ox, y: oy, z: oz } = cloud.origin;
  return (x: number, y: number, z: number): [number, number, number] => [
    x - ox,
    (z - oz) * cloud.exaggeration,
    -(y - oy),
  ];
}
