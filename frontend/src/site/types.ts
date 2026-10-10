// Job sites: dated scans of one site, its design surface, work zones and
// pay-app claims (matches the engine's app/sites.py).

/** Zone outline colours, distinct from each other and from the map's cut/fill/on-grade colours. */
export const ZONE_PALETTE = ["#ff7a1a", "#22d3ee", "#e45bff", "#9be32d", "#ffd23f", "#ff5d73", "#f0f0f0", "#b38cff"];

export interface SiteScan {
  project_id: string;
  date: string; // YYYY-MM-DD
}

export type ZoneKind = "grading" | "stockpile";

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind; // grading: progress toward design · stockpile: volume piled on original ground
  color: string;
  polygon: [number, number][]; // easting, northing
  start: string | null; // planned dates, YYYY-MM-DD
  finish: string | null;
}

export interface PayApp {
  id: string;
  date: string; // period end — the scan that measures it
  zone_id: string | null; // null = whole site
  kind: "cut" | "fill";
  claimed_m3: number;
  contractor: string;
  note: string;
}

export interface Site {
  version: 1;
  name: string;
  scans: SiteScan[];
  design_id: string | null;
  tolerance_m: number;
  change_threshold_m: number;
  overbill_pct: number;
  control_id: string | null; // check points every flight is graded against
  zones: Zone[];
  pay_apps: PayApp[];
}

/** Every scan and the design on one shared grid; row-major, row 0 = south. */
export interface SiteGrids {
  cell_size: number;
  nx: number;
  ny: number;
  x0: number; // easting / northing of the grid's south-west corner
  y0: number;
  design: (number | null)[] | null;
  scans: { project_id: string; date: string; z: (number | null)[] }[];
}
