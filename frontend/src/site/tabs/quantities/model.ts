// What the Quantities tab works out for the picked flight, memoised: every layer's
// thickness, every stockpile's volume and material, every pond's storage. The
// maths is in site/quantities.ts; this only wires it to the site and the flights.
import { useMemo } from "react";
import { useFlightRasters } from "../../rasters";
import {
  guessMaterial,
  lowestRim,
  measureLayer,
  pileMaterial,
  pileSamples,
  resolveBaseScan,
  stageLevels,
  stageStorage,
  type LayerMeasure,
  type MaterialGuess,
  type PileMaterialInfo,
  type StageStorage,
} from "../../quantities";
import type { Layer, Pond, Zone } from "../../types";
import type { SiteTabProps } from "../types";

export const cellsOfShape = (props: SiteTabProps, polygon: [number, number][]) => props.state.cellsOf({ polygon } as Zone);

// ------------------------------------------------------------------ layers

export interface LayerResult {
  layer: Layer;
  base: number | null; // flight index it's measured from
  autoBase: boolean;
  measure: LayerMeasure | null; // null: no base flight, or the picked flight isn't after it
}

export function useLayers(props: SiteTabProps): LayerResult[] {
  const { site, surfaces, scan } = props;
  const layers = site.layers ?? [];
  return useMemo(
    () =>
      layers.map((layer) => {
        const cells = cellsOfShape(props, layer.polygon);
        const { index, auto } = resolveBaseScan(layer, surfaces, site.scans, cells);
        const measure = index !== null && scan > index ? measureLayer(surfaces, surfaces.scans[index], surfaces.scans[scan], cells, layer) : null;
        return { layer, base: index, autoBase: auto, measure };
      }),
    [layers, surfaces, scan, site.scans]
  );
}

// ------------------------------------------------------------------ stockpiles

export interface PileResult {
  zone: Zone;
  volumes: number[]; // m³ above the first flight's ground, per flight
  volume: number; // at the picked flight
  change: number | null; // since the previous flight
  guess: MaterialGuess | null; // from the picked flight, else the flight the pile was biggest; null while loading
  guessFlight: number | null; // which flight the guess came from
  chosen: PileMaterialInfo | null; // the user's choice, saved on the zone
  material: PileMaterialInfo | null; // chosen, else guessed
  tonnes: number | null;
}

export function usePiles(props: SiteTabProps): { piles: PileResult[]; loading: boolean; error: string | null } {
  const { site, surfaces, state, scan, siteId, reloadKey } = props;
  const zones = useMemo(() => site.zones.filter((z) => z.kind === "stockpile"), [site.zones]);
  const progress = state.progress;
  const volumesOf = (z: Zone) => progress.find((p) => p.zone.id === z.id)?.snapshots.map((s) => s.pileVolume) ?? surfaces.scans.map(() => 0);
  const biggest = zones.map((z) => {
    const v = volumesOf(z);
    return v.indexOf(Math.max(...v));
  });
  // one fetch for the picked flight, plus each pile's biggest flight (shared, cached)
  const flights = zones.length ? [...new Set([scan, ...biggest])] : [];
  const ids = flights.map((k) => site.scans[k].project_id);
  const { rasters, error } = useFlightRasters(siteId, ids, reloadKey);

  const piles = useMemo(() => {
    const first = surfaces.scans[0];
    const guessAt = (zone: Zone, k: number): MaterialGuess | undefined => {
      const r = rasters[flights.indexOf(k)];
      if (!r) return undefined; // still loading
      return guessMaterial(pileSamples(r, surfaces.scans[k], first, cellsOfShape(props, zone.polygon)));
    };
    return zones.map((zone, n): PileResult => {
      const volumes = volumesOf(zone);
      let guess: MaterialGuess | null = null, guessFlight: number | null = null;
      for (const k of [scan, biggest[n]]) {
        const g = guessAt(zone, k);
        if (g === undefined) break;
        guess = g;
        guessFlight = k;
        if (g.material) break;
      }
      const chosen = pileMaterial(zone.material);
      const material = chosen ?? pileMaterial(guess?.material);
      const volume = volumes[scan] ?? 0;
      return {
        zone,
        volumes,
        volume,
        change: scan > 0 ? volume - volumes[scan - 1] : null,
        guess,
        guessFlight,
        chosen,
        material,
        tonnes: material ? volume * material.density : null,
      };
    });
  }, [zones, progress, rasters, scan, surfaces]);
  return { piles, loading: zones.length > 0 && rasters.some((r) => r === null) && !error, error };
}

// ------------------------------------------------------------------ ponds

export interface PondResult {
  pond: Pond;
  zone: Zone | null; // null: its zone was deleted
  built: StageStorage | null; // the picked flight
  design: StageStorage | null; // finished grade (null without a design)
  pctOfDesign: number | null;
  stillToDig: number | null; // m³ of storage the design has that the ground doesn't yet
}

export function usePonds(props: SiteTabProps): PondResult[] {
  const { site, surfaces, scan } = props;
  const ponds = site.ponds ?? [];
  return useMemo(
    () =>
      ponds.map((pond) => {
        const zone = site.zones.find((z) => z.id === pond.zone_id) ?? null;
        if (!zone) return { pond, zone, built: null, design: null, pctOfDesign: null, stillToDig: null };
        const cells = cellsOfShape(props, zone.polygon);
        const area = surfaces.cell * surfaces.cell;
        const floorOf = (z: Float64Array | null) => {
          let lo = Infinity;
          if (z) for (const i of cells) if (z[i] < lo) lo = z[i];
          return lo;
        };
        const lo = Math.min(floorOf(surfaces.scans[scan]), floorOf(surfaces.design), pond.spill_elevation_m);
        const levels = stageLevels(Number.isFinite(lo) ? lo : pond.spill_elevation_m, pond.spill_elevation_m, 30);
        const built = stageStorage(surfaces.scans[scan], cells, area, pond.spill_elevation_m, levels);
        const design = surfaces.design ? stageStorage(surfaces.design, cells, area, pond.spill_elevation_m, levels) : null;
        const pctOfDesign = design && design.storage > 0 ? (100 * built.storage) / design.storage : null;
        return { pond, zone, built, design, pctOfDesign, stillToDig: design ? Math.max(0, design.storage - built.storage) : null };
      }),
    [ponds, site.zones, surfaces, scan]
  );
}

/** Where water would first spill out of a zone on the finished grade: a starting outlet elevation. */
export function suggestOutlet(props: SiteTabProps, zone: Zone): number | null {
  const z = props.surfaces.design ?? props.surfaces.scans[props.surfaces.scans.length - 1];
  return z ? lowestRim(z, props.surfaces, cellsOfShape(props, zone.polygon)) : null;
}
