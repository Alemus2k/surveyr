import type { Composition } from "./compare/types";
import type { AccuracyStats } from "./control/qa";
import type { Site, SiteGrids, SiteScan } from "./site/types";
import type { Analysis } from "./types";
import type { Origin } from "./viewer/prepare";

declare global {
  interface Window {
    /** Set by the desktop shell before the page loads (see src-tauri/src/main.rs). */
    __SURVEYR_API__?: string;
  }
}

export type ProjectType = "single" | "fused" | "compare" | "site";

export interface ProjectRef {
  id: string;
  name: string;
  type?: ProjectType;
  site?: string; // the job site this scan belongs to, if any
}

/** API root: injected by the desktop app, else the Vite dev-server proxy. */
export function apiBase(): string {
  return (typeof window !== "undefined" && window.__SURVEYR_API__) || "/api";
}

interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

// First launch of a fresh install can be slow while macOS vets the bundled engine.
const DEFAULT_WAIT: Required<WaitOptions> = { intervalMs: 400, timeoutMs: 90_000 };

/** Resolve once the backend answers /health; the desktop app starts it in parallel. */
export async function waitForBackend(options: WaitOptions = {}): Promise<void> {
  const { intervalMs, timeoutMs } = { ...DEFAULT_WAIT, ...options };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${apiBase()}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet — keep polling until the deadline
    }
    if (Date.now() >= deadline) {
      throw new Error("The analysis engine didn't start. Try quitting and reopening Surveyr.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function fetchProjects(): Promise<ProjectRef[]> {
  const res = await fetch(`${apiBase()}/projects`);
  if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);
  return res.json() as Promise<ProjectRef[]>;
}

export async function fetchAnalysis(id: string): Promise<Analysis> {
  const res = await fetch(`${apiBase()}/analysis/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to load analysis: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<Analysis>;
}

/** Points relative to ``origin``: survey-grid coordinates don't fit in float32 alone. */
export interface PointsPayload {
  origin: Origin;
  xyz: Float32Array;
}

const ORIGIN_BYTES = 24; // 3 × float64 before the float32 triples

/** Cleaned, thinned point cloud in metres (manual adjustments applied). */
export async function fetchPoints(id: string, limit?: number): Promise<PointsPayload> {
  const query = limit ? `?limit=${limit}` : "";
  const res = await fetch(`${apiBase()}/points/${encodeURIComponent(id)}${query}`);
  if (!res.ok) {
    throw new Error(`Failed to load points: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  const o = new DataView(buf, 0, ORIGIN_BYTES);
  return {
    origin: { x: o.getFloat64(0, true), y: o.getFloat64(8, true), z: o.getFloat64(16, true) },
    xyz: new Float32Array(buf, ORIGIN_BYTES),
  };
}

export type Unit = "m" | "cm" | "mm" | "ft" | "us_ft" | "in";

export interface ScanSettings {
  version: 1;
  unit: Unit;
  up_axis: "z" | "y";
  ground_only: boolean;
  z_offset_m: number; // elevation correction added after unit conversion
}

/** What a scan's units appear to be: "crs" = stated by the file, "size" = a guess. */
export interface UnitDetection {
  unit: Unit | null;
  source: "crs" | "size" | null;
  reason: string | null;
  crs_name: string | null;
  epsg: number | null;
}

export interface ScanSettingsResponse {
  settings: ScanSettings;
  detected: UnitDetection;
}

export async function fetchScanSettings(id: string): Promise<ScanSettingsResponse> {
  const res = await fetch(`${apiBase()}/projects/${encodeURIComponent(id)}/settings`);
  if (!res.ok) throw new Error(`Couldn't load scan settings: ${await errorDetail(res)}`);
  return res.json() as Promise<ScanSettingsResponse>;
}

export async function saveScanSettings(id: string, settings: ScanSettings): Promise<ScanSettingsResponse> {
  const res = await fetch(`${apiBase()}/projects/${encodeURIComponent(id)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Couldn't save scan settings: ${await errorDetail(res)}`);
  return res.json() as Promise<ScanSettingsResponse>;
}

/** Import a .ply/.las/.laz/.xyz scan as a new project; resolves to that project. */
export async function uploadScan(file: File): Promise<ProjectRef & { detected?: UnitDetection }> {
  const body = new FormData();
  body.append("file", file, file.name);
  const res = await fetch(`${apiBase()}/scans`, { method: "POST", body });
  if (!res.ok) throw new Error(`Couldn't import ${file.name}: ${await errorDetail(res)}`);
  return res.json() as Promise<ProjectRef & { detected?: UnitDetection }>;
}

/** Move a project's scan file(s) to the Trash on the engine's machine. */
export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${apiBase()}/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Couldn't delete project: ${await errorDetail(res)}`);
}

/** FastAPI's {"detail": "..."} message, or the status code if there isn't one. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { detail?: unknown };
    if (typeof json.detail === "string") return json.detail;
  } catch {
    // non-JSON error body: fall back to the status code
  }
  return String(res.status);
}

// ------------------------------------------------------------------ comparisons

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function createComposition(name: string, projectIds: string[]): Promise<ProjectRef> {
  const res = await fetch(`${apiBase()}/compositions`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, project_ids: projectIds }),
  });
  if (!res.ok) throw new Error(`Couldn't create comparison: ${await errorDetail(res)}`);
  return res.json() as Promise<ProjectRef>;
}

export async function fetchComposition(id: string): Promise<Composition> {
  const res = await fetch(`${apiBase()}/compositions/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Couldn't load comparison: ${await errorDetail(res)}`);
  return res.json() as Promise<Composition>;
}

export async function saveComposition(id: string, comp: Composition): Promise<void> {
  const res = await fetch(`${apiBase()}/compositions/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(comp),
  });
  if (!res.ok) throw new Error(`Couldn't save comparison: ${await errorDetail(res)}`);
}

// ------------------------------------------------------------------ job sites

export async function createSite(name: string, scans: SiteScan[], designId: string | null): Promise<ProjectRef> {
  const res = await fetch(`${apiBase()}/sites`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, scans, design_id: designId }),
  });
  if (!res.ok) throw new Error(`Couldn't create site: ${await errorDetail(res)}`);
  return res.json() as Promise<ProjectRef>;
}

export async function fetchSite(id: string): Promise<Site> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Couldn't load site: ${await errorDetail(res)}`);
  return res.json() as Promise<Site>;
}

export async function saveSite(id: string, site: Site): Promise<void> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(site),
  });
  if (!res.ok) throw new Error(`Couldn't save site: ${await errorDetail(res)}`);
}

/** Every scan of a site and its design on one shared elevation grid. */
export async function fetchSiteGrids(id: string): Promise<SiteGrids> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(id)}/grids`);
  if (!res.ok) throw new Error(`Couldn't load site surfaces: ${await errorDetail(res)}`);
  return res.json() as Promise<SiteGrids>;
}

// ------------------------------------------------------------------ control points

export interface ControlSetRef {
  id: string;
  name: string;
  count: number;
  source_unit: Unit;
}

export type ColumnOrder = "PNEZD" | "PENZD" | "NEZ" | "ENZ";

export interface ControlCheckPoint {
  id: string;
  e: number;
  n: number;
  z: number;
  desc: string;
  scan_z: number | null;
  dz: number | null; // scan minus control (m); null where the scan doesn't reach
  radius_m: number | null;
  neighbours: number;
  spread_m: number | null;
}

export interface ControlCheck {
  project_id: string;
  control_id: string;
  control_name: string;
  points: ControlCheckPoint[];
  stats: AccuracyStats;
}

export interface FlightQA {
  project_id: string;
  date: string;
  stats: AccuracyStats;
  points: number;
}

export async function fetchControlSets(): Promise<ControlSetRef[]> {
  const res = await fetch(`${apiBase()}/control`);
  if (!res.ok) throw new Error(`Couldn't list control points: ${await errorDetail(res)}`);
  return res.json() as Promise<ControlSetRef[]>;
}

/** Import check points from a CSV / text export. */
export async function importControl(file: File, name: string, unit: Unit, order: ColumnOrder): Promise<ControlSetRef> {
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("name", name);
  body.append("unit", unit);
  body.append("order", order);
  const res = await fetch(`${apiBase()}/control`, { method: "POST", body });
  if (!res.ok) throw new Error(`Couldn't import ${file.name}: ${await errorDetail(res)}`);
  return res.json() as Promise<ControlSetRef>;
}

export async function deleteControl(id: string): Promise<void> {
  const res = await fetch(`${apiBase()}/control/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Couldn't delete control points: ${await errorDetail(res)}`);
}

export async function fetchControlCheck(projectId: string, controlId: string): Promise<ControlCheck> {
  const res = await fetch(`${apiBase()}/projects/${encodeURIComponent(projectId)}/control-check?control=${encodeURIComponent(controlId)}`);
  if (!res.ok) throw new Error(`Couldn't check against control: ${await errorDetail(res)}`);
  return res.json() as Promise<ControlCheck>;
}

/** Every flight of a site graded against the site's control points. */
export async function fetchSiteQA(siteId: string): Promise<FlightQA[]> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(siteId)}/qa`);
  if (!res.ok) throw new Error(`Couldn't check flights against control: ${await errorDetail(res)}`);
  return res.json() as Promise<FlightQA[]>;
}
