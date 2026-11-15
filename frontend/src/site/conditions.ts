// Site conditions: what each flight shows besides earthworks. The engine
// (backend/app/conditions.py) does the heavy, geometry-free part per flight —
// vegetation, machines, disturbed ground, coverage, the storm check — and
// returns one bit-mask raster per flight. This file applies the site's own
// outlines (limits of disturbance, ponds, zone names) so redrawing them answers
// instantly, and builds the map layers. Pure functions, tested in conditions.test.ts.

import { paintLayer, pointInShape } from "./PlanView";
import type { Site } from "./types";

/** Bits of the engine's per-flight ``marks`` raster (conditions.py). */
export const MARK = {
  MOVED: 1, // ground moved more than the change threshold since the first flight
  CLEARED: 2, // vegetation there at the first flight is gone
  CANOPY: 4, // tree canopy (> 1.5 m)
  BRUSH: 8, // brush (0.3–1.5 m)
  THIN: 16, // fewer than one ground point per m²
  WATER: 32, // no laser return at all, inside covered ground: possibly standing water
  SEDIMENT: 64, // rose where no fill is designed, or turned dark and wet
  RILL: 128, // erosion rill
} as const;

export const ACRE_M2 = 4046.8564224;

export interface Machine {
  e: number;
  n: number;
  length_m: number;
  width_m: number;
  height_m: number;
  area_m2: number;
}

export interface Rill {
  e: number;
  n: number;
  line: [number, number][];
  length_m: number;
  width_m: number;
  depth_m: number; // "up to": 90th percentile of the drop
  mean_depth_m: number;
  volume_m3: number;
  worked: boolean; // on ground being filled / cut this period
}

export interface WaterPatch {
  e: number;
  n: number;
  area_m2: number;
}

export interface FlightConditions {
  project_id: string;
  date: string;
  classified: boolean;
  has_color: boolean;
  has_intensity: boolean;
  offset_vs_first_m: number;
  vegetation: { canopy_m2: number; brush_m2: number; trees: number; canopy_patches: number; brush_patches: number };
  cleared_since_previous_m2: number;
  machines: Machine[];
  disturbed: { moved_m2: number; cleared_m2: number; total_m2: number };
  coverage: { covered_m2: number; thin_m2: number; ground_per_m2: number };
  storm: { rills: Rill[]; water: WaterPatch[]; offset_m: number; dark_m2: number };
}

export interface Conditions {
  nx: number;
  ny: number;
  cell: number;
  x0: number;
  y0: number;
  threshold: number;
  flights: FlightConditions[];
  marks: Uint8Array[]; // one per flight, row-major, row 0 = south
}

/** Area (m²) of cells carrying any of ``bits``; ``inside`` (1 = in) restricts, ``outside`` inverts it. */
export function markedArea(marks: Uint8Array, bits: number, cellArea: number, region?: Uint8Array | null, outside = false): number {
  let n = 0;
  for (let i = 0; i < marks.length; i++) {
    if (!(marks[i] & bits)) continue;
    if (region && (region[i] === 1) === outside) continue;
    n++;
  }
  return n * cellArea;
}

/** A cell list (e.g. from progress.zoneCells) as a 0/1 mask over the grid. */
export function cellMask(cells: Int32Array | null, size: number): Uint8Array | null {
  if (!cells) return null;
  const m = new Uint8Array(size);
  for (const i of cells) m[i] = 1;
  return m;
}

export interface LimitsCheck {
  outside_m2: number; // disturbed (moved or cleared) outside the limits
  movedOutside_m2: number; // of that, ground that moved
  outside: Uint8Array; // 1 where disturbed outside
}

/** Disturbed ground outside the limits of disturbance (``lod``: 1 = inside), or null with no limits drawn. */
export function outsideLimits(marks: Uint8Array, lod: Uint8Array | null, cellArea: number): LimitsCheck | null {
  if (!lod) return null;
  const outside = new Uint8Array(marks.length);
  let all = 0, moved = 0;
  for (let i = 0; i < marks.length; i++) {
    if (lod[i] || !(marks[i] & (MARK.MOVED | MARK.CLEARED))) continue;
    outside[i] = 1;
    all++;
    if (marks[i] & MARK.MOVED) moved++;
  }
  return { outside_m2: all * cellArea, movedOutside_m2: moved * cellArea, outside };
}

/** Stormwater (NPDES construction general permit) applies from one acre disturbed. */
export const needsStormwaterPermit = (disturbed_m2: number) => disturbed_m2 >= ACRE_M2;

export interface Sediment {
  area_m2: number;
  measured_m3: number; // only where the rise could be measured (not while the pond was being dug)
  e: number; // centre of the silt
  n: number;
}

const SEDIMENT_MIN_M2 = 10; // less than this in a pond is noise, not a finding

/**
 * Pond sediment: SEDIMENT cells inside the pond (``pond``: 1 = inside). Volume
 * counts only cells that measurably rose since ``before`` (minus the flight
 * offset); silt laid while the pond was being dug only shows as dark, wet ground.
 */
export function pondSediment(c: Pick<Conditions, "nx" | "cell" | "x0" | "y0" | "threshold">, marks: Uint8Array, pond: Uint8Array,
  now: Float64Array | null, before: Float64Array | null, offset: number): Sediment | null {
  let n = 0, vol = 0, se = 0, sn = 0;
  for (let i = 0; i < marks.length; i++) {
    if (!pond[i] || !(marks[i] & MARK.SEDIMENT)) continue;
    n++;
    se += i % c.nx;
    sn += Math.floor(i / c.nx);
    if (now && before) {
      const d = now[i] - before[i] - offset;
      if (Number.isFinite(d) && d > c.threshold) vol += d;
    }
  }
  const area = n * c.cell * c.cell;
  if (area < SEDIMENT_MIN_M2) return null;
  return { area_m2: area, measured_m3: vol * c.cell * c.cell, e: c.x0 + (se / n + 0.5) * c.cell, n: c.y0 + (sn / n + 0.5) * c.cell };
}

export type Severity = "repair" | "watch";

/** A rill 0.5 ft (15 cm) deep or 10 m long needs repairing; smaller ones are watched. */
export function rillSeverity(r: Pick<Rill, "depth_m" | "length_m">): Severity {
  return r.depth_m >= 0.15 || r.length_m >= 10 ? "repair" : "watch";
}

/** The first zone (by the site's order) containing a point, by name. */
export function zoneAt(site: Pick<Site, "zones">, e: number, n: number): string | null {
  return site.zones.find((z) => pointInShape(e, n, z.polygon))?.name ?? null;
}

export interface StormFinding {
  id: string;
  kind: "rill" | "water" | "sediment";
  severity: Severity;
  e: number;
  n: number;
  where: string | null; // zone name
  rill?: Rill;
  water?: WaterPatch;
  sediment?: Sediment & { pond: string };
}

/** Everything the storm check found on one flight, worst first. */
export function stormFindings(site: Pick<Site, "zones">, f: FlightConditions, sediments: (Sediment & { pond: string })[]): StormFinding[] {
  const out: StormFinding[] = [
    ...f.storm.rills.map((r, i) => ({ id: `rill${i}`, kind: "rill" as const, severity: rillSeverity(r), e: r.e, n: r.n, where: zoneAt(site, r.e, r.n), rill: r })),
    ...f.storm.water.map((w, i) => ({ id: `water${i}`, kind: "water" as const, severity: "watch" as const, e: w.e, n: w.n, where: zoneAt(site, w.e, w.n), water: w })),
    ...sediments.map((s, i) => ({ id: `sed${i}`, kind: "sediment" as const, severity: "watch" as const, e: s.e, n: s.n, where: s.pond, sediment: s })),
  ];
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "repair" ? -1 : 1));
}

// ------------------------------------------------------------------ map layers

export type LayerKind = "photo" | "intensity" | "vegetation" | "objects" | "disturbed" | "storm" | "coverage";

type RGBA = [number, number, number, number];
const BRUSH: RGBA = [166, 214, 106, 0.85];
const CANOPY_LOW: RGBA = [92, 178, 92, 0.9];
const CANOPY_HIGH: RGBA = [24, 110, 52, 0.95];
export const LAYER_COLOURS = {
  brush: BRUSH,
  canopyLow: CANOPY_LOW,
  canopyHigh: CANOPY_HIGH,
  machine: [242, 177, 52, 1] as RGBA,
  object: [242, 177, 52, 0.45] as RGBA,
  moved: [196, 152, 98, 0.75] as RGBA,
  cleared: [222, 200, 150, 0.55] as RGBA,
  outside: [229, 72, 66, 0.95] as RGBA,
  rill: [229, 72, 66, 1] as RGBA,
  water: [238, 176, 43, 0.9] as RGBA,
  sediment: [72, 136, 214, 0.85] as RGBA,
  thin: [229, 72, 66, 0.85] as RGBA,
  sparse: [238, 176, 43, 0.6] as RGBA,
};

/** Vegetation height (m) as a colour: brush light green, canopy darkening with height to 20 m. */
export function vegetationColour(h: number): RGBA | null {
  if (!Number.isFinite(h) || h < 0.3) return null;
  if (h <= 1.5) return BRUSH;
  const t = Math.min(1, (h - 1.5) / 18.5);
  return [0, 1, 2, 3].map((k) => CANOPY_LOW[k] + (CANOPY_HIGH[k] - CANOPY_LOW[k]) * t) as RGBA;
}

/** Ground points per m² as a coverage warning: red under 1, amber under 2, else nothing. */
export function coverageColour(groundPoints: number, cellArea: number, covered: boolean): RGBA | null {
  if (!covered) return null;
  const perM2 = groundPoints / cellArea;
  if (perM2 < 1) return LAYER_COLOURS.thin;
  if (perM2 < 2) return LAYER_COLOURS.sparse;
  return null;
}

export interface LayerInputs {
  kind: LayerKind;
  cells: number;
  cellArea: number;
  photo?: Uint8Array | null;
  intensity?: Uint8Array | null;
  vegHeight?: Float32Array | null;
  objectHeight?: Float32Array | null;
  groundDensity?: Uint16Array | null;
  coverage?: Uint8Array | null;
  marks?: Uint8Array | null;
  outside?: Uint8Array | null; // disturbed outside the limits
}

/** RGBA overlay for PlanView (null = just the shaded relief). */
export function conditionsLayer(p: LayerInputs): Uint8ClampedArray | null {
  const { kind, cells } = p;
  if (kind === "photo") {
    const ph = p.photo, cov = p.coverage;
    if (!ph) return null;
    return paintLayer(cells, (i) => (cov && !cov[i] ? null : [ph[i * 3], ph[i * 3 + 1], ph[i * 3 + 2], 1]));
  }
  if (kind === "intensity") {
    const it = p.intensity, gd = p.groundDensity;
    if (!it) return null;
    return paintLayer(cells, (i) => (gd && !gd[i] ? null : [it[i], it[i], Math.min(255, it[i] * 0.94 + 8), 1]));
  }
  if (kind === "vegetation") {
    const v = p.vegHeight;
    return v ? paintLayer(cells, (i) => vegetationColour(v[i])) : null;
  }
  if (kind === "objects") {
    const o = p.objectHeight;
    if (!o) return null;
    return paintLayer(cells, (i) => (!Number.isFinite(o[i]) || o[i] < 0.5 ? null : o[i] >= 1.5 ? LAYER_COLOURS.machine : LAYER_COLOURS.object));
  }
  if (kind === "coverage") {
    const gd = p.groundDensity, cov = p.coverage;
    if (!gd) return null;
    return paintLayer(cells, (i) => coverageColour(gd[i], p.cellArea, !cov || cov[i] > 0));
  }
  const m = p.marks;
  if (!m) return null;
  if (kind === "disturbed") {
    const out = p.outside;
    return paintLayer(cells, (i) =>
      out && out[i] ? LAYER_COLOURS.outside : m[i] & MARK.MOVED ? LAYER_COLOURS.moved : m[i] & MARK.CLEARED ? LAYER_COLOURS.cleared : null
    );
  }
  // storm
  return paintLayer(cells, (i) =>
    m[i] & MARK.RILL ? LAYER_COLOURS.rill : m[i] & MARK.WATER ? LAYER_COLOURS.water : m[i] & MARK.SEDIMENT ? LAYER_COLOURS.sediment : null
  );
}

/** "rgb(…)" for a legend swatch. */
export const swatch = (c: RGBA) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${c[3]})`;
