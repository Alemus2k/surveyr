// Contours and exports (engine: app/contours.py, app/exports.py).
//
// Everything the engine returns is in metres and survey coordinates (easting,
// northing). An export's `unit` option only changes what is written into the
// file; the UI still formats on-screen numbers through lib/units.ts.
import { apiBase } from "../api";
import type { UnitSystem } from "../lib/units";

// ------------------------------------------------------------------ contours

/** One contour elevation and every line drawn at it. */
export interface ContourLevel {
  elevation: number; // m
  major: boolean; // every `major_every`-th level (counted from elevation 0)
  lines: [number, number][][]; // [easting, northing] vertices; a closed line repeats its first vertex last
}

export interface Contours {
  interval: number; // m (the automatic choice when none was asked for)
  major_every: number;
  levels: ContourLevel[]; // ascending elevation; levels with no lines are left out
  bounds: [number, number, number, number]; // grid extent: west, south, east, north
  cell_size: number; // m: the grid the lines were traced on
  scan?: string; // site contours: the flight's project id, or "design"
}

/** Engine unit code the automatic interval is round in. */
export type ExportUnit = "m" | "us_ft" | "ft";

export interface ContourOptions {
  interval?: number | null; // m; omit / null = automatic from the relief
  majorEvery?: number; // default 5
  smooth?: number; // Gaussian sigma in grid cells, 0–3 (default 0: exactly as measured)
  unit?: ExportUnit; // makes the automatic interval round in feet ("us_ft" / "ft") or metres
}

/** Query string for the contour endpoints (only the options that are set). */
export function contourQuery(o: ContourOptions & { scan?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (o.scan) q.set("scan", o.scan);
  if (o.interval != null) q.set("interval", String(o.interval));
  if (o.majorEvery != null) q.set("major_every", String(o.majorEvery));
  if (o.smooth) q.set("smooth", String(o.smooth));
  if (o.unit && o.unit !== "m") q.set("unit", o.unit);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Contour lines of a scan or a LandXML design surface. */
export async function fetchProjectContours(projectId: string, o: ContourOptions = {}): Promise<Contours> {
  const res = await fetch(`${apiBase()}/projects/${encodeURIComponent(projectId)}/contours${contourQuery(o)}`);
  if (!res.ok) throw new Error(`Couldn't draw contours: ${await errorDetail(res)}`);
  return res.json() as Promise<Contours>;
}

/** Contour lines of one flight (project id), the design ("design") or the latest flight (null) on a site's grid. */
export async function fetchSiteContours(siteId: string, scan: string | null, o: ContourOptions = {}): Promise<Contours> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(siteId)}/contours${contourQuery({ ...o, scan })}`);
  if (!res.ok) throw new Error(`Couldn't draw contours: ${await errorDetail(res)}`);
  return res.json() as Promise<Contours>;
}

export interface IntervalChoice {
  label: string; // e.g. "1 ft", "0.5 m"
  metres: number; // what to send as `interval`
}

const FT = 0.3048;
const US_FT = 1200 / 3937;
const METRIC_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
const FEET_STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50];

/**
 * Contour intervals to offer, round in the user's unit system. Feet are
 * international feet by default; pass `usSurvey` for US survey feet (the
 * difference is 2 ppm: invisible on a contour, but exact if a CAD file needs it).
 */
export function intervalChoices(system: UnitSystem, usSurvey = false): IntervalChoice[] {
  if (system === "metric") return METRIC_STEPS.map((m) => ({ label: `${m} m`, metres: m }));
  const k = usSurvey ? US_FT : FT;
  return FEET_STEPS.map((f) => ({ label: `${f} ft`, metres: f * k }));
}

/** The export unit matching the display units (US customary → US survey feet, the survey default). */
export function exportUnitFor(system: UnitSystem): ExportUnit {
  return system === "metric" ? "m" : "us_ft";
}

/** Total vertices in a contour result (for "too dense to draw" guards). */
export function vertexCount(c: Contours): number {
  let n = 0;
  for (const lv of c.levels) for (const line of lv.lines) n += line.length;
  return n;
}

/**
 * Lines relative to `origin` as flat Float32 arrays [x0, y0, x1, y1, …] for
 * WebGL / canvas. Survey coordinates (millions of metres) lose ~0.5 m in
 * float32 unless the origin is subtracted first, in float64.
 */
export function relativeLines(c: Contours, origin: { x: number; y: number }): { level: ContourLevel; xy: Float32Array }[] {
  const out: { level: ContourLevel; xy: Float32Array }[] = [];
  for (const level of c.levels) {
    for (const line of level.lines) {
      const xy = new Float32Array(line.length * 2);
      line.forEach(([e, n], i) => {
        xy[2 * i] = e - origin.x;
        xy[2 * i + 1] = n - origin.y;
      });
      out.push({ level, xy });
    }
  }
  return out;
}

// ------------------------------------------------------------------ exports

export type ScanExportFormat = "dxf" | "landxml" | "csv" | "asc" | "las";
export type SiteExportFormat = ScanExportFormat | "geojson" | "progress";

/** Every option is optional; each format reads the ones it needs (others are ignored). */
export interface ExportOptions {
  unit?: ExportUnit; // file coordinates and elevations (default "m")
  scan?: string | null; // site exports: flight project id, "design" (not for las), or null = latest flight
  interval_m?: number | null; // dxf: contour interval in metres; null = automatic
  major_every?: number; // dxf: default 5
  smooth?: number; // dxf: contour smoothing, cells (0–3)
  contours?: boolean; // dxf: draw contour lines (default true)
  labels?: boolean; // dxf: label major contours (default true)
  spots?: boolean; // dxf: spot elevations (default true)
  spacing_m?: number | null; // dxf spots / csv points: spacing in metres; null = about 40 across the site
  zone_id?: string | null; // site csv: only points inside this zone
  header?: boolean; // csv: header row (default true)
  description?: string; // csv: description column (default "GROUND", max 40 chars)
  compressed?: boolean; // las: write .laz
  wgs84?: boolean; // geojson: also write a longitude/latitude copy when the scan has an EPSG code (default true)
}

export interface ExportedFile {
  path: string; // absolute path on this computer
  filename: string;
  bytes: number;
}

/** What an export wrote. The first file is the main one; `files` lists companions too (.prj, _wgs84.geojson). */
export interface ExportResult extends ExportedFile {
  files: ExportedFile[];
  // format-specific extras
  entities?: Record<string, number>; // dxf: entities per layer
  interval_m?: number | null; // dxf: contour interval used
  points?: number; // csv / las / landxml
  triangles?: number; // landxml
  spacing_m?: number; // csv: actual spacing (a whole number of grid cells)
  prj?: boolean; // asc: a .prj was written
  note?: string | null; // asc: why no .prj
  ground_only?: boolean; // las: only ground-classified points
  channels?: string[]; // las: channels carried over
  crs?: boolean; // las: coordinate system written
  features?: number; // geojson
  wgs84?: boolean; // geojson: the longitude/latitude copy was written
  zones?: number; // progress
  flights?: number; // progress
}

async function postExport(url: string, format: string, options: ExportOptions): Promise<ExportResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, options: dropUnset(options) }),
  });
  if (!res.ok) throw new Error(`Couldn't export: ${await errorDetail(res)}`);
  return res.json() as Promise<ExportResult>;
}

/** Write a scan export into the export folder (never overwrites). */
export function exportScan(projectId: string, format: ScanExportFormat, options: ExportOptions = {}): Promise<ExportResult> {
  return postExport(`${apiBase()}/exports/scan/${encodeURIComponent(projectId)}`, format, options);
}

/** Write a site export into the export folder (never overwrites). */
export function exportSite(siteId: string, format: SiteExportFormat, options: ExportOptions = {}): Promise<ExportResult> {
  return postExport(`${apiBase()}/exports/site/${encodeURIComponent(siteId)}`, format, options);
}

/** Where exports are written (created if missing), e.g. C:\Users\…\Downloads\Surveyr. */
export async function fetchExportFolder(): Promise<string> {
  const res = await fetch(`${apiBase()}/exports/folder`);
  if (!res.ok) throw new Error(`Couldn't find the export folder: ${await errorDetail(res)}`);
  return ((await res.json()) as { folder: string }).folder;
}

/** Show an exported file in Explorer / Finder. Only files in the export folder are allowed. */
export async function revealExport(path: string): Promise<void> {
  const res = await fetch(`${apiBase()}/exports/reveal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Couldn't show the file: ${await errorDetail(res)}`);
}

/** Plain-language description of each format, for pickers. */
export const FORMAT_INFO: Record<SiteExportFormat, { label: string; extension: string; forWhom: string; siteOnly?: boolean }> = {
  dxf: { label: "CAD drawing (DXF)", extension: ".dxf", forWhom: "Engineers and CAD: contours, spot elevations, zones and limits" },
  landxml: { label: "Surface (LandXML)", extension: ".xml", forWhom: "Civil design software and machine control: the ground as a triangulated surface" },
  csv: { label: "Points (CSV)", extension: ".csv", forWhom: "Surveyors and data collectors: point number, northing, easting, elevation, description" },
  asc: { label: "Elevation grid (ASCII grid)", extension: ".asc", forWhom: "GIS: one elevation per grid cell" },
  las: { label: "Ground points (LAS/LAZ)", extension: ".las", forWhom: "Anyone with point-cloud software: the cleaned ground Surveyr measures" },
  geojson: { label: "Site plan (GeoJSON)", extension: ".geojson", forWhom: "GIS and web maps: zones, limits of disturbance, alignments", siteOnly: true },
  progress: { label: "Progress data (JSON)", extension: ".json", forWhom: "Project-management software: quantities per zone per flight", siteOnly: true },
};

/** A copy without undefined / null values, so the engine's defaults apply. */
export function dropUnset<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { detail?: unknown };
    if (typeof json.detail === "string") return json.detail;
  } catch {
    // non-JSON error body: fall back to the status code
  }
  return String(res.status);
}
