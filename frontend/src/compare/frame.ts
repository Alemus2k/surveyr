// Coordinate bookkeeping for comparisons.
//
// All layers share one frame (origin = centre of their combined untransformed
// footprint, lowest point at y = 0, one vertical exaggeration). Each layer's
// geometry is stored relative to its OWN footprint centre, so rotating the
// layer's group turns it in place; its LayerTransform then shifts it.
import type { SceneBox } from "../viewer/backdrop";
import { ZERO_ORIGIN, type ColorRange, type Origin } from "../viewer/prepare";
import type { LayerTransform } from "./types";

export interface LayerExtent {
  cx: number;
  cy: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  zMin: number;
  zMax: number;
}

export interface CompareFrame {
  origin: { x: number; y: number; z: number };
  span: number;
  exaggeration: number;
  box: SceneBox;
}

/** Group placement in scene space. */
export interface Placement {
  position: [number, number, number];
  yawRad: number;
}

const MAX_EXAGGERATION = 3;
const TARGET_RELIEF_RATIO = 0.1;
const DEG = Math.PI / 180;

/** Absolute (survey-space) extent of a layer whose points are relative to ``base``. */
export function layerExtent(xyz: Float32Array, base: Origin = ZERO_ORIGIN): LayerExtent {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    const x = xyz[i], y = xyz[i + 1], z = xyz[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (x0 === Infinity) return { cx: base.x, cy: base.y, x0: base.x, x1: base.x, y0: base.y, y1: base.y, zMin: base.z, zMax: base.z };
  return {
    cx: base.x + (x0 + x1) / 2,
    cy: base.y + (y0 + y1) / 2,
    x0: base.x + x0,
    x1: base.x + x1,
    y0: base.y + y0,
    y1: base.y + y1,
    zMin: base.z + z0,
    zMax: base.z + z1,
  };
}

export function compareFrame(extents: LayerExtent[]): CompareFrame {
  const x0 = Math.min(...extents.map((e) => e.x0));
  const x1 = Math.max(...extents.map((e) => e.x1));
  const y0 = Math.min(...extents.map((e) => e.y0));
  const y1 = Math.max(...extents.map((e) => e.y1));
  const z0 = Math.min(...extents.map((e) => e.zMin));
  const z1 = Math.max(...extents.map((e) => e.zMax));
  const span = Math.max(x1 - x0, y1 - y0, 1e-6);
  const relief = Math.max(z1 - z0, 1e-6);
  const exaggeration = Math.min(MAX_EXAGGERATION, Math.max(1, (TARGET_RELIEF_RATIO * span) / relief));
  return {
    origin: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: z0 },
    span,
    exaggeration,
    box: { halfX: (x1 - x0) / 2, halfZ: (y1 - y0) / 2, height: relief * exaggeration },
  };
}

/** Survey → layer-local scene coordinates (relative to the layer's own centre). */
export function layerToLocal(ex: LayerExtent, f: CompareFrame) {
  return (x: number, y: number, z: number): [number, number, number] => [
    x - ex.cx,
    (z - f.origin.z) * f.exaggeration,
    -(y - ex.cy),
  ];
}

export function localPositions(
  xyz: Float32Array,
  ex: LayerExtent,
  f: CompareFrame,
  base: Origin = ZERO_ORIGIN
): Float32Array {
  const toLocal = layerToLocal(ex, f);
  const out = new Float32Array(xyz.length);
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    const [a, b, c] = toLocal(xyz[i] + base.x, xyz[i + 1] + base.y, xyz[i + 2] + base.z);
    out[i] = a;
    out[i + 1] = b;
    out[i + 2] = c;
  }
  return out;
}

export function placement(t: LayerTransform, ex: LayerExtent, f: CompareFrame): Placement {
  return {
    position: [ex.cx - f.origin.x + t.tx, t.tz * f.exaggeration, -(ex.cy - f.origin.y + t.ty)],
    yawRad: t.yaw_deg * DEG,
  };
}

/** Inverse of placement(): read a dragged group back into a LayerTransform. */
export function transformFromPlacement(
  position: [number, number, number],
  yawRad: number,
  ex: LayerExtent,
  f: CompareFrame
): LayerTransform {
  const yaw = ((yawRad / DEG + 540) % 360) - 180; // keep within -180..180
  return {
    tx: position[0] - (ex.cx - f.origin.x),
    ty: -position[2] - (ex.cy - f.origin.y),
    tz: position[1] / f.exaggeration,
    yaw_deg: Math.abs(yaw) < 1e-9 ? 0 : yaw,
  };
}

/** Where a layer-local point lands in the scene (matches THREE's rotation.y). */
export function applyPlacement(local: [number, number, number], p: Placement): [number, number, number] {
  const c = Math.cos(p.yawRad);
  const s = Math.sin(p.yawRad);
  const [x, y, z] = local;
  return [x * c + z * s + p.position[0], y + p.position[1], -x * s + z * c + p.position[2]];
}

/** Shared elevation colour range across layers (1st–99th percentile of all points). */
export function combinedRange(zs: Float32Array[]): ColorRange {
  const total = zs.reduce((n, z) => n + z.length, 0);
  if (total === 0) return { min: 0, max: 1 };
  const all = new Float32Array(total);
  let o = 0;
  for (const z of zs) {
    all.set(z, o);
    o += z.length;
  }
  all.sort();
  const at = (p: number) => all[Math.min(total - 1, Math.floor(p * (total - 1)))];
  return { min: at(0.01), max: at(0.99) };
}

/** A layer's points as the 3D view places them (scene coords) + their true elevations. */
export function worldPoints(
  xyz: Float32Array,
  ex: LayerExtent,
  f: CompareFrame,
  t: LayerTransform,
  base: Origin = ZERO_ORIGIN
): { positions: Float32Array; elevation: Float32Array } {
  const p = placement(t, ex, f);
  const toLocal = layerToLocal(ex, f);
  const n = Math.floor(xyz.length / 3);
  const positions = new Float32Array(n * 3);
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [wx, wy, wz] = applyPlacement(
      toLocal(xyz[i * 3] + base.x, xyz[i * 3 + 1] + base.y, xyz[i * 3 + 2] + base.z),
      p
    );
    positions[i * 3] = wx;
    positions[i * 3 + 1] = wy;
    positions[i * 3 + 2] = wz;
    elevation[i] = wy / f.exaggeration + f.origin.z;
  }
  return { positions, elevation };
}
