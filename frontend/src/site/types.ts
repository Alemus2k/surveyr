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
  // finished-grade spec inside the zone: a flat pad at this elevation, else the
  // design surface raised (+) or lowered (−) by the offset
  target_elevation_m?: number | null;
  design_offset_m?: number;
}

export type SpecField = "design_id" | "tolerance_m" | "grade" | "start" | "finish";

/** A finished-grade spec: flat pad at an elevation, else the design ± an offset. */
export interface GradeValue {
  target_elevation_m: number | null;
  design_offset_m: number;
}

/** A spec's stored value: scan id or date, tolerance in metres, finished grade, or unset. */
export type SpecValue = string | number | GradeValue | null;

/** One spec edited by a change order, as it read before and after. */
export interface SpecChange {
  field: SpecField;
  zone_id: string | null; // null = a site-wide spec
  zone_name: string | null; // kept so the log reads right if the zone is deleted
  before: string;
  after: string;
  values?: { before: SpecValue; after: SpecValue } | null; // what a void restores (absent on early orders)
}

/** A spec a void left alone: a later order changed it again, or its zone is gone. */
export interface KeptSpec {
  field: SpecField;
  zone_id: string | null;
  zone_name: string | null;
  by_number: number | null; // the later order in effect; null = the zone was deleted
}

export interface VoidRecord {
  date: string; // effective date, YYYY-MM-DD
  reason: string;
  voided_by: string;
  voided_at: string; // ISO timestamp
  restored: SpecChange[]; // what the void changed back
  kept: KeptSpec[];
}

/** A logged revision of the job specs. Append-only: the engine refuses edits, but allows one void. */
export interface ChangeOrder {
  id: string;
  number: number;
  date: string; // effective date, YYYY-MM-DD
  title: string;
  reason: string;
  requested_by: string;
  created_at: string; // ISO timestamp it was logged
  changes: SpecChange[];
  voided?: VoidRecord | null;
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
  change_orders?: ChangeOrder[]; // absent in files saved before change orders existed
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
