// Pay quantities beyond bulk earthworks, on the site's shared grid:
//  - layers: material placed in a lift (base course, asphalt, topsoil) — its
//    thickness is the rise between the flight before it was placed and a later one;
//  - stockpiles: what each pile is made of, guessed from the flight's colour and
//    intensity, so its volume can be weighed;
//  - ponds: the stage–storage curve — water held below each elevation up to the outlet.
//
// Only measured ground counts: a cell is used only where every surface involved was
// scanned. Mirrored by backend/tests/test_quantities_truth.py, which checks the same
// maths against the Riverside demo's exact answers — keep the two in step.

import type { Surfaces } from "./progress";
import type { Layer, SiteScan } from "./types";

type Grid = Pick<Surfaces, "nx" | "ny" | "cell">;

/** A survey drone's vertical accuracy per flight (m): ±2 cm on a good day, ±5 cm on a poor one. */
export const DRONE_ACCURACY_M: readonly [number, number] = [0.02, 0.05];

// ------------------------------------------------------------------ layers

export interface LayerMaterial {
  id: string;
  label: string;
  density: number | null; // typical compacted / in-place t/m³
  aliases: string[]; // other names a layer's material may be saved as
}

/** Typical in-place weights; the supplier's ticket number beats them when you have it. */
export const LAYER_MATERIALS: LayerMaterial[] = [
  { id: "base", label: "Crushed stone base", density: 2.24, aliases: ["aggregate base", "base course", "crushed stone", "gravel base", "abc", "dga"] },
  { id: "asphalt", label: "Asphalt", density: 2.32, aliases: ["asphalt concrete", "hma", "blacktop", "paving"] },
  { id: "topsoil", label: "Topsoil", density: 1.3, aliases: ["loam"] },
  { id: "sand", label: "Sand", density: 1.6, aliases: ["sand fill", "bedding sand"] },
  { id: "concrete", label: "Concrete", density: 2.4, aliases: ["slab", "pcc"] },
];

/** The preset a saved material name matches (by label or alias, any case), or null for a custom one. */
export function layerPreset(material: string): LayerMaterial | null {
  const m = material.trim().toLowerCase();
  if (!m) return null;
  return LAYER_MATERIALS.find((p) => p.label.toLowerCase() === m || p.id === m || p.aliases.includes(m)) ?? null;
}

/** Thicker than this counts as "placed": half the tolerance, a quarter of the target, never under 3 cm (scan noise). */
export function placedThreshold(layer: Pick<Layer, "target_thickness_m" | "tolerance_m">): number {
  return Math.max(layer.tolerance_m / 2, layer.target_thickness_m / 4, 0.03);
}

export type Reliability = "good" | "fair" | "poor";

/**
 * How far to trust a layer's measured thickness, from its target. Each flight is
 * ±2–5 cm, so the rise between two flights is ±3–7 cm at a spot: fine for a 6 in base,
 * meaningless for a 2 in asphalt lift (averages over the area are better than spots).
 */
export function layerReliability(target_m: number): Reliability {
  if (target_m < 0.075) return "poor";
  if (target_m < 0.15) return "fair";
  return "good";
}

/**
 * The flight a layer sits on: its ``base_scan`` if set (null if that scan has left the site),
 * else the flight before the first one where at least 10 % of the outline rose by more than
 * the placed threshold since the flight before it.
 */
export function resolveBaseScan(layer: Layer, s: Surfaces, scans: SiteScan[], cells: Int32Array): { index: number | null; auto: boolean } {
  if (layer.base_scan) {
    const k = scans.findIndex((x) => x.project_id === layer.base_scan);
    return { index: k >= 0 ? k : null, auto: false };
  }
  const thr = placedThreshold(layer);
  for (let k = 1; k < s.scans.length; k++) {
    const a = s.scans[k], b = s.scans[k - 1];
    let rose = 0, n = 0;
    for (const i of cells) {
      const d = a[i] - b[i];
      if (!Number.isFinite(d)) continue;
      n++;
      if (d > thr) rose++;
    }
    if (n > 0 && rose >= 0.1 * n) return { index: k - 1, auto: true };
  }
  return { index: null, auto: true };
}

/** Cell states on the layer map. */
export const LayerCell = {
  None: 0, // outside the outline, or not scanned in both flights
  Bare: 1, // measured, nothing placed (thinner than the placed threshold)
  Edge: 2, // placed, on the edge of the placed area: part layer, part not, so not judged
  Ok: 3, // within target ± tolerance
  Thick: 4, // thicker than target + tolerance
  Thin: 5, // thinner than target − tolerance
} as const;

export interface ThinPatch {
  cells: number;
  area: number; // m²
  thinnest: number; // m
  bbox: [number, number, number, number]; // col0, row0, col1, row1 (inclusive; row 0 = south)
}

export interface LayerMeasure {
  threshold: number; // m: thicker than this counts as placed
  outlineArea: number; // m² of cells inside the outline
  measuredArea: number; // m² scanned in both flights
  placedArea: number; // m²
  volume: number; // m³ over placed cells
  tonnes: number | null; // volume × density (null without a density)
  meanThickness: number | null; // over the inside of the placed area (edge cells straddle its edge)
  thinnest: number | null; // lowest 3 × 3-cell average inside the placed area
  thickest: number | null;
  judgedArea: number; // m² of inside cells compared to the target
  okArea: number;
  thinArea: number;
  thickArea: number;
  edgeArea: number;
  thickness: Float64Array; // per grid cell, NaN outside / unmeasured
  state: Uint8Array; // LayerCell per grid cell
  patches: ThinPatch[]; // connected thin areas, largest first
}

const NEIGHBOURS: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * A layer's thickness = ground at flight ``at`` − ground at flight ``base``, inside its
 * outline. Volume and placed area count every placed cell; the thickness check (and
 * mean / thinnest / thickest) uses only cells inside the placed area, because a cell on
 * its edge is partly covered and reads thin whatever was placed.
 */
export function measureLayer(g: Grid, base: Float64Array, at: Float64Array, cells: Int32Array, layer: Pick<Layer, "target_thickness_m" | "tolerance_m" | "density_t_m3">): LayerMeasure {
  const { nx, ny } = g;
  const area = g.cell * g.cell;
  const thr = placedThreshold(layer);
  const thickness = new Float64Array(nx * ny).fill(NaN);
  const state = new Uint8Array(nx * ny);
  let measured = 0, placed = 0, volume = 0;
  for (const i of cells) {
    const t = at[i] - base[i];
    if (!Number.isFinite(t)) continue;
    measured++;
    thickness[i] = t;
    if (t > thr) {
      placed++;
      volume += t;
      state[i] = LayerCell.Ok; // provisional: placed
    } else state[i] = LayerCell.Bare;
  }
  const isPlaced = (i: number) => state[i] >= LayerCell.Edge;
  const lo = layer.target_thickness_m - layer.tolerance_m, hi = layer.target_thickness_m + layer.tolerance_m;
  const inner: number[] = [];
  let edge = 0, ok = 0, thin = 0, thick = 0, sum = 0;
  for (const i of cells) {
    if (!isPlaced(i)) continue;
    const c = i % nx, r = (i - c) / nx;
    let onEdge = false;
    for (const [dc, dr] of NEIGHBOURS) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue; // the grid's edge isn't the layer's
      if (!isPlaced(rr * nx + cc)) onEdge = true;
    }
    if (onEdge) {
      state[i] = LayerCell.Edge;
      edge++;
      continue;
    }
    inner.push(i);
    const t = thickness[i];
    sum += t;
    if (t < lo) (state[i] = LayerCell.Thin), thin++;
    else if (t > hi) (state[i] = LayerCell.Thick), thick++;
    else ok++;
  }
  // the inside cells' 3 × 3 averages (at least 5 inside cells), so one noisy cell doesn't decide the extremes
  const smooth = new Map<number, number>();
  for (const i of inner) {
    const c = i % nx, r = (i - c) / nx;
    let s = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
        const j = rr * nx + cc;
        if (state[j] >= LayerCell.Ok) (s += thickness[j]), n++;
      }
    if (n >= 5) smooth.set(i, s / n);
  }
  let thinnest: number | null = null, thickest: number | null = null;
  const extremes = smooth.size ? [...smooth.values()] : inner.map((i) => thickness[i]);
  for (const v of extremes) {
    thinnest = thinnest === null ? v : Math.min(thinnest, v);
    thickest = thickest === null ? v : Math.max(thickest, v);
  }
  return {
    threshold: thr,
    outlineArea: cells.length * area,
    measuredArea: measured * area,
    placedArea: placed * area,
    volume: volume * area,
    tonnes: layer.density_t_m3 ? volume * area * layer.density_t_m3 : null,
    meanThickness: inner.length ? sum / inner.length : null,
    thinnest,
    thickest,
    judgedArea: inner.length * area,
    okArea: ok * area,
    thinArea: thin * area,
    thickArea: thick * area,
    edgeArea: edge * area,
    thickness,
    state,
    patches: thinPatches(g, state, thickness, smooth),
  };
}

/** Connected (4-neighbour) groups of thin cells, largest first. */
function thinPatches(g: Grid, state: Uint8Array, thickness: Float64Array, smooth: Map<number, number>): ThinPatch[] {
  const { nx, ny } = g;
  const seen = new Uint8Array(nx * ny);
  const out: ThinPatch[] = [];
  for (let start = 0; start < state.length; start++) {
    if (state[start] !== LayerCell.Thin || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let n = 0, thinnest = Infinity;
    let c0 = nx, r0 = ny, c1 = -1, r1 = -1;
    while (stack.length) {
      const i = stack.pop()!;
      n++;
      thinnest = Math.min(thinnest, smooth.get(i) ?? thickness[i]);
      const c = i % nx, r = (i - c) / nx;
      c0 = Math.min(c0, c), c1 = Math.max(c1, c), r0 = Math.min(r0, r), r1 = Math.max(r1, r);
      for (const [dc, dr] of NEIGHBOURS) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= ny) continue;
        const j = rr * nx + cc;
        if (state[j] === LayerCell.Thin && !seen[j]) (seen[j] = 1), stack.push(j);
      }
    }
    out.push({ cells: n, area: n * g.cell * g.cell, thinnest, bbox: [c0, r0, c1, r1] });
  }
  return out.sort((a, b) => b.cells - a.cells);
}

// ------------------------------------------------------------------ stockpile materials

export type PileMaterial = "topsoil" | "aggregate" | "spoil";

export interface PileMaterialInfo {
  id: PileMaterial;
  label: string;
  density: number; // typical loose (stockpiled) t/m³
  look: string; // what it looks like from the air, for the explanation
  // the class's look: mean brightness (0–255), warmth = (red − blue) / brightness,
  // and ground intensity as the flight's 0–255 stretch shows it
  v: number;
  warm: number;
  intensity: number;
}

export const PILE_MATERIALS: PileMaterialInfo[] = [
  { id: "topsoil", label: "Topsoil", density: 1.3, look: "dark brown, dull to the laser", v: 55, warm: 0.55, intensity: 20 },
  { id: "aggregate", label: "Aggregate / stone", density: 1.6, look: "grey, bright to the laser", v: 150, warm: 0.02, intensity: 230 },
  { id: "spoil", label: "Soil / spoil", density: 1.6, look: "mid brown", v: 110, warm: 0.7, intensity: 90 },
];

export const pileMaterial = (id: string | null | undefined): PileMaterialInfo | null => PILE_MATERIALS.find((m) => m.id === id) ?? null;

/** What one cell of a pile looks like: colour (0–255) and/or stretched ground intensity (0–255). */
export interface PileSample {
  rgb: [number, number, number] | null;
  intensity: number | null;
}

const MAX_MATCH = 3; // farther than this from every class (in spreads) = looks like none of them

/** The class a cell looks most like, or null when it looks like none (or has no colour or intensity). */
export function classifySample(s: PileSample): PileMaterial | null {
  if (!s.rgb && s.intensity === null) return null;
  let best: PileMaterial | null = null, bestD = Infinity;
  for (const m of PILE_MATERIALS) {
    let d = 0;
    if (s.rgb) {
      const [r, gr, b] = s.rgb;
      const v = (r + gr + b) / 3;
      const warm = (r - b) / Math.max(v, 1);
      d += ((v - m.v) / 30) ** 2 + ((warm - m.warm) / 0.25) ** 2;
    }
    if (s.intensity !== null) d += ((s.intensity - m.intensity) / (s.rgb ? 90 : 60)) ** 2;
    if (d < bestD) (bestD = d), (best = m.id);
  }
  return Math.sqrt(bestD) <= MAX_MATCH ? best : null;
}

export interface MaterialGuess {
  material: PileMaterial | null; // null: too few cells, or nothing matched
  confidence: number; // 0–1: share of the sampled cells that voted for it
  votes: Record<PileMaterial, number>;
  sampled: number;
  usedColour: boolean;
  usedIntensity: boolean;
}

const MIN_SAMPLES = 4;

/** Majority vote of the sampled cells. Confidence = the winner's share of all sampled cells. */
export function guessMaterial(samples: PileSample[]): MaterialGuess {
  const votes: Record<PileMaterial, number> = { topsoil: 0, aggregate: 0, spoil: 0 };
  for (const s of samples) {
    const m = classifySample(s);
    if (m) votes[m]++;
  }
  let material: PileMaterial | null = null;
  for (const m of PILE_MATERIALS) if (votes[m.id] > 0 && (material === null || votes[m.id] > votes[material])) material = m.id;
  const n = samples.length;
  return {
    material: n >= MIN_SAMPLES ? material : null,
    confidence: n >= MIN_SAMPLES && material ? votes[material] / n : 0,
    votes,
    sampled: n,
    usedColour: samples.some((s) => s.rgb !== null),
    usedIntensity: samples.some((s) => s.intensity !== null),
  };
}

export const confidenceWord = (c: number): "high" | "medium" | "low" => (c >= 0.7 ? "high" : c >= 0.45 ? "medium" : "low");

/** What a flight recorded, as far as material guessing needs it (a FlightRasters fits). */
export interface MaterialRasters {
  photo: Uint8Array | null;
  intensity: Uint8Array | null;
  vegHeight: Float32Array;
  objectHeight: Float32Array;
}

/**
 * Cells to judge a pile by: the upper part of it (higher than 30 cm and 40 % of the pile's
 * height above the first flight), so the ground round its toe doesn't mix in, and nothing
 * standing on it (machines, plants) whose colour would be read instead of the pile's.
 */
export function pileSamples(r: MaterialRasters, ground: Float64Array, original: Float64Array, cells: Int32Array): PileSample[] {
  let top = 0;
  for (const i of cells) {
    const h = ground[i] - original[i];
    if (h > top) top = h;
  }
  const min = Math.max(0.3, 0.4 * top);
  const out: PileSample[] = [];
  if (top < 0.3) return out;
  for (const i of cells) {
    if (!(ground[i] - original[i] > min)) continue;
    if (Number.isFinite(r.vegHeight[i]) || Number.isFinite(r.objectHeight[i])) continue;
    out.push({
      rgb: r.photo ? [r.photo[i * 3], r.photo[i * 3 + 1], r.photo[i * 3 + 2]] : null,
      intensity: r.intensity ? r.intensity[i] : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ pond storage

export interface StagePoint {
  elevation: number; // m
  volume: number; // m³ of water held below it
}

export interface StageStorage {
  floor: number | null; // lowest measured ground in the zone
  outlet: number;
  storage: number; // m³ below the outlet, measured cells only
  curve: StagePoint[];
  seenArea: number; // m² of the zone with ground measured
  unseenArea: number; // m² with no ground return (standing water, machines, gaps)
  unseenUpTo: number; // m³ the unseen cells could add if they were as low as the lowest ground seen
  zoneArea: number;
}

/** Elevations from ``lo`` to ``hi`` in ``n`` equal steps (both ends included). */
export function stageLevels(lo: number, hi: number, n = 24): number[] {
  if (!(hi > lo)) return [hi];
  return Array.from({ length: n + 1 }, (_, k) => lo + ((hi - lo) * k) / n);
}

/** Water held below ``elevation`` over measured cells: Σ max(0, elevation − ground) × cell area. */
export function storageBelow(z: Float64Array, cells: Int32Array, cellArea: number, elevation: number): number {
  let v = 0;
  for (const i of cells) {
    const d = elevation - z[i];
    if (d > 0) v += d; // NaN (unmeasured) fails the test
  }
  return v * cellArea;
}

/** Stage–storage of a pond zone on one surface, the curve at ``levels`` (elevations, m). */
export function stageStorage(z: Float64Array, cells: Int32Array, cellArea: number, outlet: number, levels: number[]): StageStorage {
  let floor = Infinity, seen = 0;
  for (const i of cells) {
    if (!Number.isFinite(z[i])) continue;
    seen++;
    floor = Math.min(floor, z[i]);
  }
  const unseen = cells.length - seen;
  const hasFloor = Number.isFinite(floor);
  return {
    floor: hasFloor ? floor : null,
    outlet,
    storage: storageBelow(z, cells, cellArea, outlet),
    curve: levels.filter((e) => e <= outlet + 1e-9).map((elevation) => ({ elevation, volume: storageBelow(z, cells, cellArea, elevation) })),
    seenArea: seen * cellArea,
    unseenArea: unseen * cellArea,
    unseenUpTo: hasFloor ? unseen * cellArea * Math.max(0, outlet - floor) : 0,
    zoneArea: cells.length * cellArea,
  };
}

/** The lowest finished-grade elevation on the zone's edge: where water would first spill out. */
export function lowestRim(z: Float64Array, g: Grid, cells: Int32Array): number | null {
  const inZone = new Set<number>(cells);
  let lo: number | null = null;
  for (const i of cells) {
    if (!Number.isFinite(z[i])) continue;
    const c = i % g.nx, r = (i - c) / g.nx;
    const rim = NEIGHBOURS.some(([dc, dr]) => !inZone.has((r + dr) * g.nx + (c + dc)) || c + dc < 0 || c + dc >= g.nx);
    if (rim && (lo === null || z[i] < lo)) lo = z[i];
  }
  return lo;
}
