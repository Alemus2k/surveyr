// Checks & records: the engine's fine-detail checks on a flight's points
// (backend/app/checks.py). Every payload is metric. Requests carry the shape
// being checked, so an outline being edited is checked as drawn, before it saves.
import { useEffect, useState } from "react";
import { apiBase } from "../api";

type Num = number | null; // null = no measurement there (a gap, never a guess)

export interface Profile {
  station: number[];
  e: number[];
  n: number[];
  flight: Num[];
  previous: Num[] | null;
  design: Num[] | null;
}

export interface Section {
  station: number;
  e: number;
  n: number;
  line: [[number, number], [number, number]];
  offset: Num[]; // − left, + right of the alignment
  flight: Num[];
  previous: Num[] | null;
  design: Num[] | null;
}

export interface SectionsResult {
  scan: string;
  previous_scan: string | null;
  has_design: boolean;
  length_m: number;
  long_step_m: number;
  long_band_m: number;
  section_step_m: number;
  section_band_m: number;
  long: Omit<Profile, "station"> & { station: Num[] };
  sections: Section[];
}

export type FlagLevel = "bad" | "warn" | "info";
export interface TrenchFlag {
  code: "pe_design" | "protective_system" | "protective_system_sloped" | "spoil_setback" | "ladder" | "pipe_not_seen";
  level: FlagLevel;
  depth_m?: number;
  from_m?: number;
  to_m?: number;
  setback_m?: number;
  side?: "left" | "right";
}

export interface TrenchRow {
  station: number;
  e: number;
  n: number;
  ground: number;
  floor: number;
  depth: number;
  width: number;
  pipe_top: number | null;
  invert: number | null;
}

export interface Wall {
  run_m: number | null;
  ratio_h_to_v: number | null;
  vertical: boolean;
}

export interface Spoil {
  present: boolean;
  height_m?: number;
  setback_m?: number;
  crest_m?: number;
}

export interface TrenchResult {
  scan: string;
  date: string;
  length_m: number; // the drawn line
  diameter_m: number;
  classified: boolean;
  open: boolean;
  from_m?: number;
  to_m?: number;
  trench_length_m?: number;
  width_m?: number;
  depth_mean_m?: number;
  depth_max_m?: number;
  depth_min_m?: number;
  walls?: { left: Wall; right: Wall };
  spoil?: { left: Spoil; right: Spoil };
  pipe?: {
    seen: boolean;
    slope_pct?: number; // + rises along the line
    invert_start_m?: number;
    invert_end_m?: number;
    top_start_m?: number;
    top_end_m?: number;
    fit_rms_m?: number;
    points?: number;
  };
  flags?: TrenchFlag[];
  table?: TrenchRow[];
  direction?: [number, number];
  profile?: { station: number[]; ground: Num[]; floor: Num[] };
}

export type StretchStatus = "ok" | "check" | "fail";
export interface Stretch {
  from_m: number;
  to_m: number;
  length_m: number;
  points: number;
  running_pct: number;
  cross_pct: number;
  running_se_pct: number;
  cross_se_pct: number;
  running_status: StretchStatus;
  cross_status: StretchStatus;
  status: StretchStatus;
  outline: [number, number][];
  start: [number, number];
  end: [number, number];
  middle: [number, number];
}

export interface FlatworkResult {
  scan: string;
  date: string;
  kind: "walk" | "ramp" | "landing" | "parking";
  classified: boolean;
  running_limit_pct: number;
  cross_limit_pct: number;
  points: number;
  enough: boolean;
  length_m?: number;
  width_m?: number;
  noise_m?: number;
  density_per_m2?: number;
  axis?: [number, number];
  start?: [number, number];
  end?: [number, number];
  stretches?: Stretch[];
  local?: ({ at_m: number; running_pct: number; cross_pct: number } | null)[];
}

export interface MonitorFlight {
  measured: boolean;
  cells: number;
  area_m2?: number;
  mean_m?: number;
  settled_max_m?: number;
  settled_e?: number;
  settled_n?: number;
  heave_max_m?: number;
  heave_e?: number;
  heave_n?: number;
  over_alert_m2?: number;
  over_alert_cells?: number;
  alert?: boolean;
  mean_uncertainty_m?: number;
  cell_uncertainty_m?: number | null;
}

export interface MonitorResult {
  dates: string[];
  scans: string[];
  flights: MonitorFlight[];
  inside_cells: number;
  levelled: boolean;
  offsets_m: number[] | null;
  noise_m: number | null;
  baseline: "auto" | "fixed";
  baseline_flights: number[];
  window_cells: number;
  cell_size: number;
  alert_m: number;
  grid: { c0: number; r0: number; nx: number; ny: number };
  movement: Num[][]; // per flight, row-major over grid (row 0 = south), metres; − = settled
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      // not JSON
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return (await res.json()) as T;
}

const base = (siteId: string) => `/sites/${encodeURIComponent(siteId)}/checks`;

export const fetchSections = (siteId: string, body: { scan: string; points: [number, number][]; interval_m: number; half_width_m: number }) =>
  post<SectionsResult>(`${base(siteId)}/sections`, body);
export const fetchTrench = (siteId: string, body: { scan: string; line: [number, number][]; diameter_m: number; every_m?: number }) =>
  post<TrenchResult>(`${base(siteId)}/trench`, body);
export const fetchFlatwork = (siteId: string, body: { scan: string; kind: string; polygon: [number, number][] }) =>
  post<FlatworkResult>(`${base(siteId)}/flatwork`, body);
export const fetchMonitor = (siteId: string, body: { polygon: [number, number][]; baseline_scan: string | null; alert_m: number }) =>
  post<MonitorResult>(`${base(siteId)}/monitor`, body);

// one request per (endpoint, body, settings version); shared by the verdict and the detail views
const cache = new Map<string, Promise<unknown>>();

function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  let hit = cache.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = run();
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
    if (cache.size > 120) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

export interface CheckState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Run several checks of one kind and keep their results, in order. ``bodies`` are
 * request bodies (null = nothing to check there); a request repeats only when its
 * body or ``reloadKey`` changes.
 */
export function useChecks<B, T>(siteId: string, kind: string, bodies: (B | null)[], run: (siteId: string, body: B) => Promise<T>, reloadKey = 0): CheckState<T>[] {
  const keys = bodies.map((b) => (b === null ? "" : `${siteId}
${reloadKey}
${kind}
${JSON.stringify(b)}`));
  const joined = keys.join("\u0000");
  const [results, setResults] = useState<Record<string, { data: T | null; error: string | null }>>({});
  useEffect(() => {
    let live = true;
    keys.forEach((key, i) => {
      const body = bodies[i];
      if (!key || body === null) return;
      cached(key, () => run(siteId, body)).then(
        (data) => live && setResults((r) => (r[key]?.data === data ? r : { ...r, [key]: { data, error: null } })),
        (e) => live && setResults((r) => ({ ...r, [key]: { data: null, error: e instanceof Error ? e.message : String(e) } }))
      );
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  return keys.map((key) => {
    if (!key) return { data: null, error: null, loading: false };
    const r = results[key];
    return r ? { ...r, loading: false } : { data: null, error: null, loading: true };
  });
}

/** One check (see useChecks). */
export function useCheck<B, T>(siteId: string, kind: string, body: B | null, run: (siteId: string, body: B) => Promise<T>, reloadKey = 0): CheckState<T> {
  return useChecks(siteId, kind, [body], run, reloadKey)[0];
}
