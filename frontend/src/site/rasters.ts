// What each flight recorded besides the ground shape, on the site's shared
// grid (engine: sites.rasters). Row-major, row 0 = south, like the surfaces.
import { useEffect, useState } from "react";
import { apiBase } from "../api";
import { unpack } from "../lib/binary";

export interface FlightRasters {
  projectId: string;
  nx: number;
  ny: number;
  cell: number;
  x0: number;
  y0: number;
  classified: boolean; // false: the scan has no ground classes, so the height layers are empty
  coverage: Uint8Array; // 1 where the flight has any points
  photo: Uint8Array | null; // rgb per cell (nx·ny·3): the site seen from above; null without colour
  intensity: Uint8Array | null; // ground reflectance, contrast-stretched; bright = aggregate / concrete
  vegHeight: Float32Array; // tallest vegetation above the ground (m); NaN = none
  objectHeight: Float32Array; // tallest non-ground, non-vegetation point above the ground (m): machines, structures
  density: Uint16Array; // points per cell, every class
  groundDensity: Uint16Array; // ground points per cell
}

interface Header {
  project_id: string;
  nx: number;
  ny: number;
  cell_size: number;
  x0: number;
  y0: number;
  classified: boolean;
}

export async function fetchFlightRasters(siteId: string, projectId: string): Promise<FlightRasters> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(siteId)}/rasters/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`Couldn't load what the flight recorded: ${res.status}`);
  const { header: h, arrays: a } = unpack<Header>(await res.arrayBuffer());
  return {
    projectId: h.project_id,
    nx: h.nx,
    ny: h.ny,
    cell: h.cell_size,
    x0: h.x0,
    y0: h.y0,
    classified: h.classified,
    coverage: a.coverage as Uint8Array,
    photo: (a.photo as Uint8Array | undefined) ?? null,
    intensity: (a.intensity as Uint8Array | undefined) ?? null,
    vegHeight: a.veg_height as Float32Array,
    objectHeight: a.object_height as Float32Array,
    density: a.density as Uint16Array,
    groundDensity: a.ground_density as Uint16Array,
  };
}

// one fetch per (site, flight, settings version), shared by every tab that asks
const cache = new Map<string, Promise<FlightRasters>>();

function load(siteId: string, projectId: string, reloadKey: number): Promise<FlightRasters> {
  const key = `${siteId}\n${projectId}\n${reloadKey}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetchFlightRasters(siteId, projectId);
    hit.catch(() => cache.delete(key)); // a failure can be retried
    cache.set(key, hit);
    if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

export interface RastersState {
  rasters: (FlightRasters | null)[]; // one per requested flight, null while loading
  error: string | null;
}

/**
 * Rasters for some of a site's flights (pass project ids; order is kept).
 * Bump ``reloadKey`` when a scan's settings change.
 */
export function useFlightRasters(siteId: string, projectIds: string[], reloadKey = 0): RastersState {
  const key = projectIds.join("\n");
  const [state, setState] = useState<{ key: string; rasters: (FlightRasters | null)[]; error: string | null }>({ key: "", rasters: [], error: null });

  useEffect(() => {
    let live = true;
    const want = `${siteId}\n${reloadKey}\n${key}`;
    const ids = key ? key.split("\n") : [];
    setState({ key: want, rasters: ids.map(() => null), error: null });
    ids.forEach((id, i) => {
      load(siteId, id, reloadKey).then(
        (r) => live && setState((s) => (s.key === want ? { ...s, rasters: s.rasters.map((x, j) => (j === i ? r : x)) } : s)),
        (e) => live && setState((s) => (s.key === want ? { ...s, error: e instanceof Error ? e.message : String(e) } : s))
      );
    });
    return () => {
      live = false;
    };
  }, [siteId, key, reloadKey]);

  return { rasters: state.rasters.length === projectIds.length ? state.rasters : projectIds.map(() => null), error: state.error };
}
