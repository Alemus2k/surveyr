// Construction progress from repeat scans: how much of each zone is still off
// design, how much moved between scans, where that trend lands against the
// planned finish, and whether pay-app claims match what was measured.
//
// Volumes are prismatic cells on the site's shared grid, counting only cells
// measured in every surface involved. Differences within the tolerance (vs
// design) or the change threshold (scan to scan) are treated as zero, so scan
// noise never reads as work done.

import type { PayApp, Site, SiteGrids, Zone } from "./types";

/** Shared-grid surfaces as numbers (NaN = not scanned). */
export interface Surfaces {
  nx: number;
  ny: number;
  cell: number;
  x0: number;
  y0: number;
  design: Float64Array | null;
  scans: Float64Array[];
  dates: string[];
}

export function toSurfaces(g: SiteGrids): Surfaces {
  const conv = (flat: (number | null)[]) => Float64Array.from(flat, (v) => (v === null ? NaN : v));
  return {
    nx: g.nx,
    ny: g.ny,
    cell: g.cell_size,
    x0: g.x0,
    y0: g.y0,
    design: g.design ? conv(g.design) : null,
    scans: g.scans.map((s) => conv(s.z)),
    dates: g.scans.map((s) => s.date),
  };
}

// ------------------------------------------------------------------ geometry

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
  }
  return inside;
}

/** Indices of grid cells whose centre lies inside ``poly`` (null polygon = every cell). */
export function zoneCells(s: Pick<Surfaces, "nx" | "ny" | "cell" | "x0" | "y0">, poly: [number, number][] | null): Int32Array {
  const out: number[] = [];
  if (!poly) {
    for (let i = 0; i < s.nx * s.ny; i++) out.push(i);
    return Int32Array.from(out);
  }
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of poly) {
    xmin = Math.min(xmin, x);
    xmax = Math.max(xmax, x);
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  const c0 = Math.max(0, Math.floor((xmin - s.x0) / s.cell));
  const c1 = Math.min(s.nx - 1, Math.ceil((xmax - s.x0) / s.cell));
  const r0 = Math.max(0, Math.floor((ymin - s.y0) / s.cell));
  const r1 = Math.min(s.ny - 1, Math.ceil((ymax - s.y0) / s.cell));
  for (let r = r0; r <= r1; r++) {
    const y = s.y0 + (r + 0.5) * s.cell;
    for (let c = c0; c <= c1; c++) {
      if (pointInPolygon(s.x0 + (c + 0.5) * s.cell, y, poly)) out.push(r * s.nx + c);
    }
  }
  return Int32Array.from(out);
}

// ------------------------------------------------------------------ volumes

export interface CutFill {
  cut: number; // m³
  fill: number;
  area: number; // m² of cells that counted
}

/** Volume of ``a`` above / below ``b`` over ``cells``, ignoring differences within ``deadband``. */
export function cutFill(a: Float64Array, b: Float64Array, cells: Int32Array, cellArea: number, deadband: number): CutFill {
  let cut = 0, fill = 0, n = 0;
  for (const i of cells) {
    const d = a[i] - b[i];
    if (!Number.isFinite(d)) continue;
    n++;
    if (d > deadband) cut += d;
    else if (d < -deadband) fill -= d;
  }
  return { cut: cut * cellArea, fill: fill * cellArea, area: n * cellArea };
}

/** Earth moved between two scans: ground that went down was dug, ground that went up was placed. */
export function earthMoved(before: Float64Array, after: Float64Array, cells: Int32Array, cellArea: number, threshold: number) {
  const v = cutFill(before, after, cells, cellArea, threshold);
  return { dug: v.cut, placed: v.fill, area: v.area };
}

/** Share of measured cells within ``tol`` of design (0–100), or null if none overlap. */
export function onGradePct(scan: Float64Array, design: Float64Array, cells: Int32Array, tol: number): number | null {
  let ok = 0, n = 0;
  for (const i of cells) {
    const d = scan[i] - design[i];
    if (!Number.isFinite(d)) continue;
    n++;
    if (Math.abs(d) <= tol) ok++;
  }
  return n ? (100 * ok) / n : null;
}

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;

/** Whole days since 1970 for a YYYY-MM-DD date (UTC, so time zones never shift it). */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(day: number): string {
  return new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);
}

/** Planned % complete at ``date`` for a linear schedule from start (0 %) to finish (100 %). */
export function plannedPct(zone: Pick<Zone, "start" | "finish">, date: string): number | null {
  if (!zone.start || !zone.finish) return null;
  const s = dayNumber(zone.start), f = dayNumber(zone.finish), t = dayNumber(date);
  if (f <= s) return t >= f ? 100 : 0;
  return Math.min(100, Math.max(0, (100 * (t - s)) / (f - s)));
}

// ------------------------------------------------------------------ zone progress

export interface Snapshot {
  date: string;
  measuredArea: number; // m² of the zone measured in this scan (and the design)
  remainingCut: number; // grading: still above design (m³ bank)
  remainingFill: number; // grading: still below design (m³ compacted)
  onGradePct: number | null; // grading: share of the zone within tolerance
  pct: number | null; // grading: % of the zone's earthworks done since the first scan
  pileVolume: number; // stockpile: m³ above the original (first-scan) ground
  cut: number; // dug out since the previous scan (m³)
  fill: number; // placed since the previous scan (m³)
}

export type Status = "done" | "on-track" | "behind" | "stalled" | "not-started" | "unplanned";

export interface ZoneProgress {
  zone: Zone;
  cells: number;
  snapshots: Snapshot[]; // one per scan, oldest first
  baseline: number; // grading: earthworks to do at the first scan (m³ cut + fill)
  rate: number | null; // % complete per day over recent scans
  forecast: string | null; // date the trend reaches 100 %
  doneOn: string | null; // first scan at which the zone was complete
  status: Status;
  scheduleGap: number | null; // latest % complete minus planned % on that date
}

const DONE_PCT = 98; // real scans leave ~1 % residual (noise on batters) even on finished ground
const MIN_BASELINE_M3 = 1; // less than this to move and there's nothing to track
const TREND_SCANS = 3; // forecast from the last few scans' trend
const MAX_FORECAST_DAYS = 730; // a trend slower than this isn't a schedule, it's a stall

/** Least-squares slope of y against x. */
function slope(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}

export function zoneProgress(s: Surfaces, zone: Zone, site: Pick<Site, "tolerance_m" | "change_threshold_m">, cells?: Int32Array): ZoneProgress {
  const idx = cells ?? zoneCells(s, zone.polygon);
  const area = s.cell * s.cell;
  const grading = zone.kind === "grading" && s.design !== null;
  let baseline = 0;

  const snapshots: Snapshot[] = s.scans.map((scan, k) => {
    const vsDesign = grading ? cutFill(scan, s.design!, idx, area, site.tolerance_m) : null;
    const change = k > 0 ? earthMoved(s.scans[k - 1], scan, idx, area, site.change_threshold_m) : null;
    const pile = zone.kind === "stockpile" && k > 0 ? earthMoved(s.scans[0], scan, idx, area, site.change_threshold_m) : null;
    const remaining = vsDesign ? vsDesign.cut + vsDesign.fill : 0;
    if (k === 0) baseline = remaining;
    return {
      date: s.dates[k],
      measuredArea: vsDesign?.area ?? change?.area ?? 0,
      remainingCut: vsDesign?.cut ?? 0,
      remainingFill: vsDesign?.fill ?? 0,
      onGradePct: grading ? onGradePct(scan, s.design!, idx, site.tolerance_m) : null,
      pct: grading && baseline >= MIN_BASELINE_M3 ? Math.min(100, Math.max(0, 100 * (1 - remaining / baseline))) : null,
      pileVolume: pile?.placed ?? 0,
      cut: change?.dug ?? 0,
      fill: change?.placed ?? 0,
    };
  });

  const tracked = snapshots.filter((x) => x.pct !== null);
  const doneSnap = tracked.find((x) => x.pct! >= DONE_PCT);
  const recent = tracked.slice(-TREND_SCANS);
  const rate = slope(recent.map((x) => dayNumber(x.date)), recent.map((x) => x.pct!));
  const last = tracked[tracked.length - 1];
  let forecast: string | null = null;
  if (doneSnap) forecast = doneSnap.date;
  else if (last && rate && rate > 0 && (100 - last.pct!) / rate <= MAX_FORECAST_DAYS)
    forecast = fromDayNumber(dayNumber(last.date) + (100 - last.pct!) / rate);

  const planned = last ? plannedPct(zone, last.date) : null;
  const scheduleGap = planned === null || !last ? null : last.pct! - planned;
  let status: Status;
  if (zone.kind !== "grading" || !last) status = "unplanned";
  else if (doneSnap) status = "done";
  else if (last.pct! < 0.5 && (!zone.start || dayNumber(last.date) < dayNumber(zone.start))) status = "not-started";
  else if (!forecast) status = "stalled"; // no progress, or too slow to ever finish
  else if (!zone.finish) status = "unplanned";
  else status = forecast && dayNumber(forecast) <= dayNumber(zone.finish) ? "on-track" : "behind";

  return {
    zone,
    cells: idx.length,
    snapshots,
    baseline,
    rate,
    forecast,
    doneOn: doneSnap?.date ?? null,
    status,
    scheduleGap,
  };
}

// ------------------------------------------------------------------ pay apps

export interface PayAppCheck {
  payApp: PayApp;
  fromDate: string | null; // the scan the period is measured from
  measured: number | null; // m³ measured over the period (null: no scans to compare)
  diff: number | null; // claimed − measured
  diffPct: number | null;
  flagged: boolean; // claimed more than the allowed margin above measured
}

/**
 * Measure a pay-app period: the change in its zone between the scan on its
 * period-end date (or the latest before it) and the scan before that.
 */
export function checkPayApp(s: Surfaces, pa: PayApp, zones: Zone[], site: Pick<Site, "change_threshold_m" | "overbill_pct">): PayAppCheck {
  let k = -1;
  s.dates.forEach((d, i) => {
    if (dayNumber(d) <= dayNumber(pa.date)) k = i;
  });
  if (k < 1) return { payApp: pa, fromDate: null, measured: null, diff: null, diffPct: null, flagged: false };
  const zone = pa.zone_id ? zones.find((z) => z.id === pa.zone_id) : null;
  const cells = zoneCells(s, zone ? zone.polygon : null);
  const ch = earthMoved(s.scans[k - 1], s.scans[k], cells, s.cell * s.cell, site.change_threshold_m);
  const measured = pa.kind === "cut" ? ch.dug : ch.placed;
  const diff = pa.claimed_m3 - measured;
  const diffPct = measured > 0 ? (100 * diff) / measured : null;
  const flagged = diffPct === null ? pa.claimed_m3 > 0 : diffPct > site.overbill_pct;
  return { payApp: pa, fromDate: s.dates[k - 1], measured, diff, diffPct, flagged };
}

// ------------------------------------------------------------------ site summary

/** Overall % complete: zones weighted by how much earthworks each started with. */
export function overallPct(progress: ZoneProgress[]): number | null {
  let done = 0, total = 0;
  for (const p of progress) {
    const last = p.snapshots[p.snapshots.length - 1];
    if (p.zone.kind !== "grading" || last?.pct === null || last === undefined) continue;
    total += p.baseline;
    done += (p.baseline * last.pct!) / 100;
  }
  return total > 0 ? (100 * done) / total : null;
}
