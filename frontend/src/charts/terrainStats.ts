// Terrain figures for the panels and charts, computed from the analysis grids.
// Everything works on scanned cells only (see the analysis "mask"), so the
// interpolated corners outside a scan's outline never skew the numbers.

/** Grid values where the scanned mask is set (a missing mask means all cells). */
export function maskedValues(grid: number[][], mask: number[][] | undefined): number[] {
  const out: number[] = [];
  grid.forEach((row, iy) =>
    row.forEach((v, ix) => {
      if ((!mask || mask[iy]?.[ix]) && Number.isFinite(v)) out.push(v);
    })
  );
  return out;
}

export function percentAtOrBelow(values: number[], threshold: number): number {
  if (values.length === 0) return 0;
  return (100 * values.filter((v) => v <= threshold).length) / values.length;
}

export interface EarthworksCurve {
  levels: number[]; // candidate pad elevations (m)
  cut: number[]; // m³ to dig out at each level
  fill: number[]; // m³ to bring in at each level
  balance: number; // pad elevation where cut = fill (the mean elevation)
  moved: number; // m³ cut (= m³ filled) at the balance point
}

/**
 * Cut and fill volumes for a flat pad at each of ``steps`` levels between the
 * lowest and highest scanned cell (prismatic cells, like the backend).
 */
export function earthworksCurve(z: number[], cellSize: number, steps = 60): EarthworksCurve {
  const area = cellSize * cellSize;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of z) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return { levels: [], cut: [], fill: [], balance: 0, moved: 0 };
  const levels = Array.from({ length: steps }, (_, i) => lo + ((hi - lo) * i) / Math.max(steps - 1, 1));
  const cut: number[] = [];
  const fill: number[] = [];
  for (const t of levels) {
    let c = 0;
    let f = 0;
    for (const v of z) {
      if (v > t) c += v - t;
      else f += t - v;
    }
    cut.push(c * area);
    fill.push(f * area);
  }
  // For a flat pad, cut − fill = Σ(z − t)·area, which is zero exactly at the mean
  // elevation — so the balance point (and the volume moved) is exact, not sampled.
  const balance = z.reduce((a, v) => a + v, 0) / z.length;
  let moved = 0;
  for (const v of z) if (v > balance) moved += v - balance;
  return { levels, cut, fill, balance, moved: moved * area };
}

export interface SlopeClass {
  from: number;
  to: number;
  pct: number;
}

/** Share of the site in each slope class; ``edges`` in degrees, last may be Infinity. */
export function slopeClasses(slopes: number[], edges: number[]): SlopeClass[] {
  const counts = new Array<number>(edges.length - 1).fill(0);
  for (const s of slopes) {
    for (let i = 0; i < counts.length; i++) {
      if (s >= edges[i] && s < edges[i + 1]) {
        counts[i]++;
        break;
      }
    }
  }
  const n = slopes.length || 1;
  return counts.map((c, i) => ({ from: edges[i], to: edges[i + 1], pct: (100 * c) / n }));
}

export interface AspectRose {
  fractions: number[]; // per sector, clockwise from north; sums to 1 over sloped ground
  flatPct: number; // % of cells too flat to have a meaningful direction
}

/** Which way sloped ground faces, in ``sectors`` compass bins centred on N, E, … */
export function aspectRose(aspect: number[], slope: number[], sectors = 16, minSlope = 1): AspectRose {
  const counts = new Array<number>(sectors).fill(0);
  const width = 360 / sectors;
  let sloped = 0;
  for (let i = 0; i < aspect.length; i++) {
    if (!(slope[i] >= minSlope)) continue;
    sloped++;
    const bin = Math.floor((((aspect[i] + width / 2) % 360) + 360) % 360 / width) % sectors;
    counts[bin]++;
  }
  return {
    fractions: counts.map((c) => (sloped ? c / sloped : 0)),
    flatPct: aspect.length ? (100 * (aspect.length - sloped)) / aspect.length : 0,
  };
}
