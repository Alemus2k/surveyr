// Earthworks for levelling a job site: a design pad (flat or with a drainage
// fall), cut/fill volumes against the scanned ground, a balance solver that
// accounts for compaction, and haul quantities with swell and truckloads.
//
// Volumes use prismatic cells over scanned ground only, like the rest of the app.

/** Scanned cells of the analysis grid, flattened for fast repeated passes. */
export interface SiteCells {
  x: Float64Array; // cell centre easting (m)
  y: Float64Array; // cell centre northing (m)
  z: Float64Array; // ground elevation (m)
  ix: Int32Array; // grid column / row of each cell (for drawing maps)
  iy: Int32Array;
  cellArea: number; // m² per cell
  cx: number; // footprint centre, used as the pad's reference point
  cy: number;
}

export interface Grade {
  slopePct: number; // drainage fall, % (0 = flat)
  fallsTowardDeg: number; // compass direction the pad drops toward (0 = north)
}

export interface Design extends Grade {
  base: number; // pad elevation at the footprint centre (m)
}

export interface Volumes {
  cut: number; // m³ of ground above the pad (bank, in place)
  fill: number; // m³ of space below the pad (compacted)
  cutArea: number; // m²
  fillArea: number;
  maxCut: number; // m, deepest dig
  maxFill: number; // m, highest build-up
}

export interface Material {
  swellPct: number; // excavated soil bulks up by this much when loose
  shrinkPct: number; // fill compacts down by this much from bank volume
}

export interface Haul {
  fillBank: number; // bank m³ needed to make the compacted fill
  direction: "export" | "import" | "balanced";
  bank: number; // m³ (bank) to remove or bring in
  loose: number; // m³ as carried in trucks (swollen)
  loads: number; // truckloads
}

interface GridInput {
  x: number[];
  y: number[];
  z: number[][];
  mask?: number[][];
}

export function siteCells(grid: GridInput, cellSize: number): SiteCells {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const cols: number[] = [];
  const rows: number[] = [];
  grid.z.forEach((row, iy) =>
    row.forEach((v, ix) => {
      if ((grid.mask && !grid.mask[iy]?.[ix]) || !Number.isFinite(v)) return;
      xs.push(grid.x[ix]);
      ys.push(grid.y[iy]);
      zs.push(v);
      cols.push(ix);
      rows.push(iy);
    })
  );
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    x0 = Math.min(x0, xs[i]);
    x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]);
    y1 = Math.max(y1, ys[i]);
  }
  return {
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    z: Float64Array.from(zs),
    ix: Int32Array.from(cols),
    iy: Int32Array.from(rows),
    cellArea: cellSize * cellSize,
    cx: xs.length ? (x0 + x1) / 2 : 0,
    cy: ys.length ? (y0 + y1) / 2 : 0,
  };
}

/** Pad elevation at every scanned cell. */
export function designGrid(site: SiteCells, d: Design): Float64Array {
  const rad = (d.fallsTowardDeg * Math.PI) / 180;
  const ex = Math.sin(rad); // unit vector of the fall direction (x east, y north)
  const ny = Math.cos(rad);
  const s = d.slopePct / 100;
  const out = new Float64Array(site.z.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = d.base - s * ((site.x[i] - site.cx) * ex + (site.y[i] - site.cy) * ny);
  }
  return out;
}

export function volumes(site: SiteCells, target: Float64Array): Volumes {
  let cut = 0, fill = 0, cutN = 0, fillN = 0, maxCut = 0, maxFill = 0;
  for (let i = 0; i < site.z.length; i++) {
    const d = site.z[i] - target[i];
    if (d > 0) {
      cut += d;
      cutN++;
      if (d > maxCut) maxCut = d;
    } else if (d < 0) {
      fill -= d;
      fillN++;
      if (-d > maxFill) maxFill = -d;
    }
  }
  const a = site.cellArea;
  return { cut: cut * a, fill: fill * a, cutArea: cutN * a, fillArea: fillN * a, maxCut, maxFill };
}

const BISECT_STEPS = 60;

/**
 * Pad elevation (at the footprint centre) where cut exactly supplies the fill
 * once compacted: cut = fill / (1 − shrink). Cut − fill/(1 − shrink) falls
 * monotonically as the pad rises, so bisection converges.
 */
export function balancedBase(site: SiteCells, grade: Grade, shrink: number): number {
  if (site.z.length === 0) return 0;
  const offsets = designGrid(site, { ...grade, base: 0 });
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < site.z.length; i++) {
    const b = site.z[i] - offsets[i]; // base at which this cell is exactly on grade
    if (b < lo) lo = b;
    if (b > hi) hi = b;
  }
  const keep = 1 - Math.min(Math.max(shrink, 0), 0.95);
  for (let k = 0; k < BISECT_STEPS; k++) {
    const mid = (lo + hi) / 2;
    const v = volumes(site, designGrid(site, { ...grade, base: mid }));
    if (v.cut - v.fill / keep > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const BALANCED_TOLERANCE = 0.005; // within 0.5 % of the material moved counts as balanced

export function haul(v: Pick<Volumes, "cut" | "fill">, m: Material, truckM3: number): Haul {
  const keep = 1 - Math.min(Math.max(m.shrinkPct / 100, 0), 0.95);
  const fillBank = v.fill / keep;
  const net = v.cut - fillBank; // + surplus to export, − shortfall to import
  const moved = v.cut + fillBank;
  if (Math.abs(net) <= Math.max(0.01, moved * BALANCED_TOLERANCE)) {
    return { fillBank, direction: "balanced", bank: 0, loose: 0, loads: 0 };
  }
  const bank = Math.abs(net);
  const loose = bank * (1 + Math.max(m.swellPct, 0) / 100);
  return {
    fillBank,
    direction: net > 0 ? "export" : "import",
    bank,
    loose,
    loads: truckM3 > 0 ? Math.ceil(loose / truckM3 - 1e-9) : 0,
  };
}

export interface DirtLedger {
  usedForFill: number; // bank m³ of cut that goes into the depressions
  leftOver: number; // bank m³ of cut remaining after every depression is filled
  shortfall: number; // bank m³ still needed once all the cut is used
  usedPct: number; // share of the cut used as fill (0–100)
}

/** Where the dug-out soil goes: into the depressions first, the remainder off site. */
export function dirtLedger(cutBank: number, fillBank: number): DirtLedger {
  const usedForFill = Math.min(cutBank, fillBank);
  return {
    usedForFill,
    leftOver: Math.max(cutBank - fillBank, 0),
    shortfall: Math.max(fillBank - cutBank, 0),
    usedPct: cutBank > 0 ? (100 * usedForFill) / cutBank : 0,
  };
}
