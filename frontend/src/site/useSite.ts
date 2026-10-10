import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSite, fetchSiteGrids, fetchSiteQA, saveSite, type FlightQA } from "../api";
import { checkPayApp, toSurfaces, zoneCells, zoneProgress, type PayAppCheck, type Surfaces, type ZoneProgress } from "./progress";
import type { Site, SiteGrids, Zone } from "./types";

const SAVE_DELAY_MS = 400;

export interface SiteState {
  site: Site | null;
  surfaces: Surfaces | null; // scans in date order, matching site.scans
  progress: ZoneProgress[]; // one per zone, in zone order
  checks: PayAppCheck[]; // one per pay app, in pay-app order
  qa: FlightQA[]; // each flight graded against the site's check points (empty without them)
  loading: boolean; // surfaces being (re)built by the engine
  error: string | null;
  saveError: string | null;
  update: (change: (s: Site) => Site) => void;
  updateZone: (id: string, patch: Partial<Zone>) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byDate = (s: Site): Site => ({ ...s, scans: [...s.scans].sort((a, b) => a.date.localeCompare(b.date)) });

// zone cell lists only change when a polygon is redrawn
const cellCache = new WeakMap<object, { grid: SiteGrids; cells: Int32Array }>();

/**
 * A site's settings (auto-saved), its surfaces on the shared grid, and the
 * progress of every zone. Bump ``reloadKey`` when a member scan's units change.
 */
export function useSite(siteId: string | null, reloadKey = 0): SiteState {
  const [site, setSite] = useState<Site | null>(null);
  const [grids, setGrids] = useState<SiteGrids | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [qa, setQa] = useState<FlightQA[]>([]);
  const pending = useRef<{ id: string; site: Site } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    try {
      await saveSite(job.id, job.site);
      setSaveError(null);
    } catch (e) {
      setSaveError(message(e));
    }
  }, []);

  useEffect(() => {
    setSite(null);
    setGrids(null);
    setError(null);
    if (!siteId) return;
    let live = true;
    fetchSite(siteId)
      .then((s) => live && setSite(byDate(s)))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
      void flush(); // don't lose the last edit when switching tabs
    };
  }, [siteId, flush]);

  // surfaces depend only on which scans (and design) belong to the site
  const members = site ? [...site.scans.map((s) => s.project_id)].sort().join("\n") + `\n#${site.design_id ?? ""}` : null;
  useEffect(() => {
    if (!siteId || members === null) return;
    let live = true;
    setLoading(true);
    flush() // the engine reads membership from the saved file
      .then(() => fetchSiteGrids(siteId))
      .then((g) => live && setGrids(g))
      .catch((e) => live && setError(message(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [siteId, members, reloadKey, flush]);

  // flight accuracy: re-checked when scans, the control set or any scan's settings change
  const controlId = site?.control_id ?? null;
  useEffect(() => {
    setQa([]);
    if (!siteId || members === null || !controlId) return;
    let live = true;
    flush()
      .then(() => fetchSiteQA(siteId))
      .then((q) => live && setQa(q))
      .catch(() => live && setQa([])); // QA is advisory: the dashboard works without it
    return () => {
      live = false;
    };
  }, [siteId, members, controlId, reloadKey, flush]);

  const update = useCallback(
    (change: (s: Site) => Site) => {
      setSite((s) => {
        if (!s || !siteId) return s;
        const next = byDate(change(s));
        pending.current = { id: siteId, site: next };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
        return next;
      });
    },
    [siteId, flush]
  );

  const updateZone = useCallback(
    (id: string, patch: Partial<Zone>) => update((s) => ({ ...s, zones: s.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) })),
    [update]
  );

  // surfaces follow the site's (editable) scan dates, in date order
  const scanKey = site?.scans.map((s) => `${s.project_id}@${s.date}`).join("\n") ?? "";
  const surfaces = useMemo(() => {
    if (!site || !grids || grids.nx === 0) return null;
    const all = toSurfaces(grids);
    const index = new Map(grids.scans.map((s, i) => [s.project_id, i]));
    const kept = site.scans.filter((s) => index.has(s.project_id));
    return { ...all, scans: kept.map((s) => all.scans[index.get(s.project_id)!]), dates: kept.map((s) => s.date) };
  }, [grids, scanKey]);

  const progress = useMemo(() => {
    if (!site || !surfaces || !grids) return [];
    return site.zones.map((z) => {
      let hit = cellCache.get(z.polygon);
      if (!hit || hit.grid !== grids) {
        hit = { grid: grids, cells: zoneCells(surfaces, z.polygon) };
        cellCache.set(z.polygon, hit);
      }
      return zoneProgress(surfaces, z, site, hit.cells);
    });
  }, [site?.zones, site?.tolerance_m, site?.change_threshold_m, surfaces]);

  const checks = useMemo(
    () => (site && surfaces ? site.pay_apps.map((pa) => checkPayApp(surfaces, pa, site.zones, site)) : []),
    [site?.pay_apps, site?.zones, site?.change_threshold_m, site?.overbill_pct, surfaces]
  );

  return { site, surfaces, progress, checks, qa, loading, error, saveError, update, updateZone };
}
