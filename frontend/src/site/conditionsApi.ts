// Fetching a site's conditions (engine: GET /api/sites/{id}/conditions, backend/app/conditions.py).
import { useEffect, useState } from "react";
import { apiBase } from "../api";
import { unpack } from "../lib/binary";
import type { Conditions, FlightConditions } from "./conditions";

interface Header {
  nx: number;
  ny: number;
  cell_size: number;
  x0: number;
  y0: number;
  threshold_m: number;
  flights: FlightConditions[];
}

export async function fetchConditions(siteId: string): Promise<Conditions> {
  const res = await fetch(`${apiBase()}/sites/${encodeURIComponent(siteId)}/conditions`);
  if (!res.ok) throw new Error(`Couldn't read the site's conditions: ${res.status}`);
  const { header: h, arrays } = unpack<Header>(await res.arrayBuffer());
  return {
    nx: h.nx,
    ny: h.ny,
    cell: h.cell_size,
    x0: h.x0,
    y0: h.y0,
    threshold: h.threshold_m,
    flights: h.flights,
    marks: h.flights.map((_, k) => arrays[`marks${k}`] as Uint8Array),
  };
}

// one fetch per site + settings version, shared across mounts (and peeked by the tab count)
const cache = new Map<string, Promise<Conditions>>();
const done = new Map<string, Conditions>();

function load(key: string, siteId: string): Promise<Conditions> {
  let hit = cache.get(key);
  if (!hit) {
    hit = fetchConditions(siteId);
    hit.then((c) => done.set(siteId, c), () => cache.delete(key));
    cache.set(key, hit);
    if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

/** The latest loaded conditions of a site, if any (synchronous; for the tab's count badge). */
export const peekConditions = (siteId: string): Conditions | null => done.get(siteId) ?? null;

/**
 * A site's conditions. ``version`` should change whenever the engine's answer
 * would (members, scan settings, change threshold, tolerance). If the answer
 * comes back computed with a different threshold than ``threshold`` (the site
 * file wasn't saved yet), it is fetched again shortly.
 */
export function useConditions(siteId: string, version: string, threshold: number) {
  const [state, setState] = useState<{ key: string; data: Conditions | null; error: string | null }>({ key: "", data: null, error: null });
  const [retry, setRetry] = useState(0);
  const key = `${siteId}\n${version}\n${retry}`;

  useEffect(() => {
    let live = true;
    setState((s) => ({ key, data: s.data, error: null }));
    load(key, siteId).then(
      (data) => {
        if (!live) return;
        setState({ key, data, error: null });
        if (Math.abs(data.threshold - threshold) > 1e-9 && retry < 3) setTimeout(() => live && setRetry((r) => r + 1), 700);
      },
      (e) => live && setState({ key, data: null, error: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data: state.data, loading: state.key !== key || (!state.data && !state.error), error: state.error };
}
