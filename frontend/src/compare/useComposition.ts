import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAnalysis, fetchComposition, fetchPoints, saveComposition } from "../api";
import type { Origin } from "../viewer/prepare";
import type { SurfaceGrid } from "../viewer/surface";
import { compareFrame, layerExtent, type CompareFrame, type LayerExtent } from "./frame";
import type { Composition, LayerSettings } from "./types";

const POINTS_PER_LAYER = 150_000; // keeps several overlaid layers smooth
const SAVE_DELAY_MS = 400;

export interface LayerData {
  xyz: Float32Array; // relative to base
  base: Origin;
  z: Float32Array;
  extent: LayerExtent;
  surface: SurfaceGrid | null; // fetched the first time the layer is shown as a surface
}

export interface CompositionState {
  comp: Composition | null;
  data: ReadonlyMap<string, LayerData>;
  frame: CompareFrame | null;
  error: string | null;
  saveError: string | null;
  update: (change: (c: Composition) => Composition) => void;
  updateLayer: (projectId: string, patch: Partial<LayerSettings>) => void;
}

const EMPTY: ReadonlyMap<string, LayerData> = new Map();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function zOf(xyz: Float32Array, base: Origin): Float32Array {
  const z = new Float32Array(xyz.length / 3);
  for (let i = 0; i < z.length; i++) z[i] = xyz[i * 3 + 2] + base.z;
  return z;
}

/**
 * A comparison's settings (auto-saved) plus each layer's loaded geometry.
 * Bump ``reloadKey`` to drop cached layer data (e.g. a scan's units changed).
 */
export function useComposition(compId: string | null, reloadKey = 0): CompositionState {
  const [comp, setComp] = useState<Composition | null>(null);
  // layer data is tied to the reload key it was fetched under, so a reload
  // starts from an empty cache within the same render (no stale skips)
  const [store, setStore] = useState<{ key: number; map: Map<string, LayerData> }>({ key: reloadKey, map: new Map() });
  const data = store.key === reloadKey ? store.map : EMPTY;
  const setData = useCallback(
    (change: (d: Map<string, LayerData>) => Map<string, LayerData>) =>
      setStore((st) => ({ key: reloadKey, map: change(st.key === reloadKey ? st.map : new Map()) })),
    [reloadKey]
  );
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<{ id: string; comp: Composition } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const job = pending.current;
    pending.current = null;
    if (job) saveComposition(job.id, job.comp).then(() => setSaveError(null), (e) => setSaveError(message(e)));
  }, []);

  // load the comparison itself
  useEffect(() => {
    setComp(null);
    setError(null);
    if (!compId) return;
    let live = true;
    fetchComposition(compId)
      .then((c) => live && setComp(c))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
      flush(); // don't lose the last edit when switching tabs
    };
  }, [compId, flush]);

  // load points for layers we haven't fetched yet
  const ids = comp?.layers.map((l) => l.project_id).join("\n") ?? "";
  useEffect(() => {
    if (!comp) return;
    let live = true;
    for (const layer of comp.layers) {
      if (data.has(layer.project_id)) continue;
      fetchPoints(layer.project_id, POINTS_PER_LAYER)
        .then(({ xyz, origin }) => {
          if (!live) return;
          const entry = { xyz, base: origin, z: zOf(xyz, origin), extent: layerExtent(xyz, origin), surface: null };
          setData((d) => new Map(d).set(layer.project_id, entry));
        })
        .catch((e) => live && setError(message(e)));
    }
    return () => {
      live = false;
    };
  }, [ids, reloadKey]); // keyed on which layers exist, not every settings change

  // fetch surface grids on demand
  const surfaceIds = comp?.layers.filter((l) => l.render === "surface").map((l) => l.project_id).join("\n") ?? "";
  useEffect(() => {
    if (!comp) return;
    let live = true;
    for (const layer of comp.layers) {
      const loaded = data.get(layer.project_id);
      if (layer.render !== "surface" || !loaded || loaded.surface) continue;
      fetchAnalysis(layer.project_id)
        .then((a) => {
          if (!live) return;
          const z = a.maps.elevation.data;
          const grid: SurfaceGrid = { x: a.grid.x, y: a.grid.y, z, mask: a.maps.mask?.data ?? z.map((r) => r.map(() => 1)) };
          setData((d) => {
            const cur = d.get(layer.project_id);
            return cur ? new Map(d).set(layer.project_id, { ...cur, surface: grid }) : d;
          });
        })
        .catch((e) => live && setError(message(e)));
    }
    return () => {
      live = false;
    };
  }, [surfaceIds, data]);

  const update = useCallback(
    (change: (c: Composition) => Composition) => {
      setComp((c) => {
        if (!c || !compId) return c;
        const next = change(c);
        pending.current = { id: compId, comp: next };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
        return next;
      });
    },
    [compId, flush]
  );

  const updateLayer = useCallback(
    (projectId: string, patch: Partial<LayerSettings>) =>
      update((c) => ({ ...c, layers: c.layers.map((l) => (l.project_id === projectId ? { ...l, ...patch } : l)) })),
    [update]
  );

  // frame from every loaded layer's untransformed footprint; stable while layers move
  const frameKey = comp?.layers.filter((l) => data.has(l.project_id)).map((l) => l.project_id).join("\n") ?? "";
  const frame = useMemo(() => {
    if (!comp) return null;
    const extents = comp.layers.flatMap((l) => {
      const d = data.get(l.project_id);
      return d ? [d.extent] : [];
    });
    return extents.length ? compareFrame(extents) : null;
  }, [frameKey]); // recompute only when the set of loaded layers changes, not on every edit

  return { comp, data, frame, error, saveError, update, updateLayer };
}
