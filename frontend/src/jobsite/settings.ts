import { useEffect, useState } from "react";
import { loadPref, savePref } from "../lib/persist";

/** Typical swell/shrinkage figures; real values vary with moisture and compaction. */
export const MATERIALS: ReadonlyArray<{ id: string; label: string; swellPct: number; shrinkPct: number }> = [
  { id: "earth", label: "Common earth", swellPct: 25, shrinkPct: 10 },
  { id: "clay", label: "Clay", swellPct: 35, shrinkPct: 15 },
  { id: "sand", label: "Sand & gravel", swellPct: 12, shrinkPct: 8 },
  { id: "topsoil", label: "Topsoil", swellPct: 30, shrinkPct: 15 },
];
export const CUSTOM_MATERIAL = "custom";

export const DIRECTIONS: ReadonlyArray<[string, number]> = [
  ["North", 0],
  ["North-east", 45],
  ["East", 90],
  ["South-east", 135],
  ["South", 180],
  ["South-west", 225],
  ["West", 270],
  ["North-west", 315],
];

export interface JobsiteSettings {
  mode: "balanced" | "custom";
  customBase: number | null; // pad elevation (m) when mode is custom
  slopePct: number;
  fallsTowardDeg: number;
  materialId: string;
  swellPct: number;
  shrinkPct: number;
  truckM3: number;
}

export const DEFAULT_TRUCK_M3 = 10; // typical tandem dump truck, loose volume
export const DEFAULT_JOBSITE: JobsiteSettings = {
  mode: "balanced",
  customBase: null,
  slopePct: 0,
  fallsTowardDeg: 0,
  materialId: "earth",
  swellPct: 25,
  shrinkPct: 10,
  truckM3: DEFAULT_TRUCK_M3,
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Validate saved settings field by field; anything unusable falls back to the default. */
export function parseJobsite(raw: unknown): JobsiteSettings {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_JOBSITE;
  return {
    mode: o.mode === "custom" ? "custom" : "balanced",
    customBase: typeof o.customBase === "number" && Number.isFinite(o.customBase) ? o.customBase : null,
    slopePct: num(o.slopePct, 0, 20, d.slopePct),
    fallsTowardDeg: num(o.fallsTowardDeg, 0, 359, d.fallsTowardDeg),
    materialId: typeof o.materialId === "string" ? o.materialId : d.materialId,
    swellPct: num(o.swellPct, 0, 100, d.swellPct),
    shrinkPct: num(o.shrinkPct, 0, 50, d.shrinkPct),
    truckM3: num(o.truckM3, 1, 100, d.truckM3),
  };
}

const anyValue = (_: unknown): _ is unknown => true; // parseJobsite does the validating

/** Job-site settings for one scan, remembered on this computer. */
export function useJobsiteSettings(projectId: string | null): [JobsiteSettings, (patch: Partial<JobsiteSettings>) => void] {
  const key = projectId ? `surveyr.jobsite.${projectId}` : null;
  const [state, setState] = useState<{ key: string | null; settings: JobsiteSettings }>(() => ({
    key,
    settings: key ? parseJobsite(loadPref(key, anyValue)) : DEFAULT_JOBSITE,
  }));
  // switching scans loads that scan's settings within the same render
  const settings = state.key === key ? state.settings : key ? parseJobsite(loadPref(key, anyValue)) : DEFAULT_JOBSITE;

  useEffect(() => {
    if (key && state.key === key) savePref(key, state.settings);
  }, [key, state]);

  // build on the latest stored settings, so quick successive edits never undo each other
  const update = (patch: Partial<JobsiteSettings>) =>
    setState((st) => {
      const current = st.key === key ? st.settings : key ? parseJobsite(loadPref(key, anyValue)) : DEFAULT_JOBSITE;
      return { key, settings: parseJobsite({ ...current, ...patch }) };
    });
  return [settings, update];
}
