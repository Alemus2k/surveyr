// A plan-view bucket grid over a prepared cloud's points, built once per cloud,
// so hover picking and ground snapping stay well under a frame on 200k points
// (three's Points raycast tests every point on every mouse move).
//
// Everything here is in *scene* coordinates (x east, y up — exaggerated — and
// z = −north, centred on the cloud's origin). Callers convert with
// geometry.sceneToSurvey; elevations returned by groundAt are true metres.

import { median } from "./geometry";

/** The parts of a PreparedCloud the index reads. */
export interface IndexedCloud {
  count: number;
  positions: Float32Array; // scene xyz
  z: Float32Array; // true elevations, same order
}

export interface Ray {
  origin: [number, number, number];
  dir: [number, number, number]; // unit length
}

export interface PickOptions {
  /** Angular pick radius in radians (≈ pixels × field-of-view / viewport height). */
  angle: number;
  /** Smallest pick radius in scene units, so close-up picks still find a point. */
  minRadius: number;
}

export interface PickHit {
  index: number; // point index
  t: number; // distance along the ray
}

export interface GroundIndex {
  /** Mean plan spacing between points, scene units. */
  spacing: number;
  cell: number;
  /** The point nearest the camera within the pick cone, or null. */
  pick: (ray: Ray, opts: PickOptions) => PickHit | null;
  /** Indices of up to ``k`` points nearest (sx, sz) in plan, nearest first, within ``maxRadius``. */
  nearest: (sx: number, sz: number, k: number, maxRadius: number) => number[];
  /** True ground elevation at (sx, sz): median of the k nearest in plan, or null if none within reach. */
  groundAt: (sx: number, sz: number, k?: number) => number | null;
}

export const SNAP_K = 9; // points whose median elevation is "the ground" at a spot
const SNAP_REACH = 4; // × spacing: further than this from any point = not scanned
const POINTS_PER_CELL = 4; // grid cell ≈ 2 × spacing

export function buildGroundIndex(cloud: IndexedCloud): GroundIndex {
  const { count, positions } = cloud;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (count === 0) {
    x0 = x1 = z0 = z1 = y0 = y1 = 0;
  }
  const w = Math.max(x1 - x0, 1e-6), d = Math.max(z1 - z0, 1e-6);
  const spacing = Math.sqrt((w * d) / Math.max(count, 1));
  const cell = Math.max(spacing * Math.sqrt(POINTS_PER_CELL), 1e-6);
  const cols = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(d / cell));
  const cellOf = (x: number, z: number): [number, number] => [
    Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / cell))),
    Math.min(rows - 1, Math.max(0, Math.floor((z - z0) / cell))),
  ];

  // counting sort of point indices by cell
  const start = new Int32Array(cols * rows + 1);
  const cellIdx = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const [c, r] = cellOf(positions[i * 3], positions[i * 3 + 2]);
    cellIdx[i] = r * cols + c;
    start[cellIdx[i] + 1]++;
  }
  for (let k = 0; k < cols * rows; k++) start[k + 1] += start[k];
  const items = new Int32Array(count);
  const fill = start.slice(0, cols * rows);
  for (let i = 0; i < count; i++) items[fill[cellIdx[i]]++] = i;

  const stamp = new Uint32Array(cols * rows);
  let epoch = 0;
  const nextEpoch = () => {
    if (++epoch === 0xffffffff) {
      stamp.fill(0);
      epoch = 1;
    }
    return epoch;
  };

  function pick(ray: Ray, { angle, minRadius }: PickOptions): PickHit | null {
    const [ox, oy, oz] = ray.origin;
    const [dx, dy, dz] = ray.dir;
    const pad = Math.max(minRadius, 0);
    // clip the ray to the cloud's box (grown by the largest pick radius it could need)
    let tMin = 0, tMax = Infinity;
    const slab = (o: number, dd: number, lo: number, hi: number): boolean => {
      if (Math.abs(dd) < 1e-12) return o >= lo && o <= hi;
      let a = (lo - o) / dd, b = (hi - o) / dd;
      if (a > b) [a, b] = [b, a];
      tMin = Math.max(tMin, a);
      tMax = Math.min(tMax, b);
      return tMin <= tMax;
    };
    // a first pass without the angular growth gives the far end; then grow by the radius there
    const grow = (t: number) => pad + angle * t;
    let reach = grow(0);
    for (let pass = 0; pass < 2; pass++) {
      tMin = 0;
      tMax = Infinity;
      const ok =
        slab(ox, dx, x0 - reach, x1 + reach) && slab(oy, dy, y0 - reach, y1 + reach) && slab(oz, dz, z0 - reach, z1 + reach);
      if (!ok) return null;
      reach = grow(tMax);
    }
    const planLen = Math.hypot(dx, dz);
    const dt = planLen > 1e-9 ? cell / 2 / planLen : Infinity;
    const ep = nextEpoch();
    let best: PickHit | null = null;
    for (let t = tMin; ; t += dt) {
      const tc = Math.min(t, tMax);
      // nothing further along can beat the best hit once we're past it (+ the cone's reach)
      if (best && tc - grow(tc) - cell > best.t) break;
      const r = grow(tc);
      const ring = Math.ceil(r / cell) + 1;
      const [cc, cr] = cellOf(ox + dx * tc, oz + dz * tc);
      for (let j = Math.max(0, cr - ring); j <= Math.min(rows - 1, cr + ring); j++) {
        for (let i = Math.max(0, cc - ring); i <= Math.min(cols - 1, cc + ring); i++) {
          const k = j * cols + i;
          if (stamp[k] === ep) continue;
          stamp[k] = ep;
          for (let s = start[k]; s < start[k + 1]; s++) {
            const p = items[s];
            const px = positions[p * 3] - ox, py = positions[p * 3 + 1] - oy, pz = positions[p * 3 + 2] - oz;
            const along = px * dx + py * dy + pz * dz;
            if (along <= 0 || (best && along >= best.t)) continue;
            const perp2 = px * px + py * py + pz * pz - along * along;
            const lim = pad + angle * along;
            if (perp2 <= lim * lim) best = { index: p, t: along };
          }
        }
      }
      if (tc >= tMax) break;
    }
    return best;
  }

  function nearest(sx: number, sz: number, k: number, maxRadius: number): number[] {
    if (count === 0 || k <= 0) return [];
    const [cc, cr] = cellOf(sx, sz);
    const found: { i: number; d2: number }[] = [];
    const maxRing = Math.ceil(maxRadius / cell) + 1;
    for (let ring = 0; ring <= maxRing; ring++) {
      // every cell in this ring is at least (ring − 1) cells away in plan
      if (found.length >= k) {
        found.sort((a, b) => a.d2 - b.d2);
        const kth = Math.sqrt(found[k - 1].d2);
        if (kth <= (ring - 1) * cell) break;
      }
      for (let j = cr - ring; j <= cr + ring; j++) {
        if (j < 0 || j >= rows) continue;
        const edge = j === cr - ring || j === cr + ring;
        for (let i = cc - ring; i <= cc + ring; i += edge ? 1 : 2 * ring || 1) {
          if (i < 0 || i >= cols) continue;
          const c = j * cols + i;
          for (let s = start[c]; s < start[c + 1]; s++) {
            const p = items[s];
            const ddx = positions[p * 3] - sx, ddz = positions[p * 3 + 2] - sz;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 <= maxRadius * maxRadius) found.push({ i: p, d2 });
          }
        }
      }
    }
    found.sort((a, b) => a.d2 - b.d2);
    return found.slice(0, k).map((f) => f.i);
  }

  function groundAt(sx: number, sz: number, k = SNAP_K): number | null {
    const near = nearest(sx, sz, k, spacing * SNAP_REACH);
    // a lone point at the edge of the scan is not ground we can stand behind
    if (near.length < Math.min(3, k)) return null;
    return median(near.map((i) => cloud.z[i]));
  }

  return { spacing, cell, pick, nearest, groundAt };
}
