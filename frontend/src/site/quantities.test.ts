import { describe, expect, test } from "vitest";
import type { Surfaces } from "./progress";
import {
  classifySample,
  guessMaterial,
  layerPreset,
  layerReliability,
  LayerCell,
  lowestRim,
  measureLayer,
  pileSamples,
  placedThreshold,
  resolveBaseScan,
  stageLevels,
  stageStorage,
  storageBelow,
} from "./quantities";
import type { Layer } from "./types";

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);

/** A grid of 1 m cells from rows written north-first, as they'd be drawn. */
function grid(rowsNorthFirst: number[][]): Float64Array {
  return Float64Array.from([...rowsNorthFirst].reverse().flat());
}

const LAYER = { target_thickness_m: 0.2, tolerance_m: 0.03, density_t_m3: 2.0 };

describe("layers", () => {
  test("placed threshold: half the tolerance, a quarter of the target, at least 3 cm", () => {
    expect(placedThreshold({ target_thickness_m: 0.2, tolerance_m: 0.03 })).toBeCloseTo(0.05, 9);
    expect(placedThreshold({ target_thickness_m: 0.05, tolerance_m: 0.01 })).toBe(0.03);
    expect(placedThreshold({ target_thickness_m: 0.2, tolerance_m: 0.2 })).toBe(0.1);
  });

  test("a 5 × 5 layer: volume and area count every placed cell; the check uses only the inside", () => {
    // 7 × 7 grid, base flat at 10 m; a 5 × 5 block rises 0.2 m except one thin cell (0.12)
    const nx = 7, ny = 7;
    const base = new Float64Array(nx * ny).fill(10);
    const at = grid([
      [10, 10, 10, 10, 10, 10, 10],
      [10, 10.2, 10.2, 10.2, 10.2, 10.2, 10],
      [10, 10.2, 10.2, 10.12, 10.2, 10.2, 10],
      [10, 10.2, 10.2, 10.2, 10.26, 10.2, 10],
      [10, 10.2, 10.2, 10.2, 10.2, 10.2, 10],
      [10, 10.2, 10.2, 10.2, 10.2, 10.2, 10],
      [10, 10, 10, 10, 10, 10, 10],
    ]);
    const m = measureLayer({ nx, ny, cell: 1 }, base, at, all(nx * ny), LAYER);
    expect(m.placedArea).toBe(25);
    expect(m.volume).toBeCloseTo(24 * 0.2 + 0.12 + 0.06, 9); // 4.98 m³
    expect(m.tonnes).toBeCloseTo(4.98 * 2, 9);
    expect(m.edgeArea).toBe(16); // the ring of the 5 × 5 block
    expect(m.judgedArea).toBe(9);
    expect(m.thinArea).toBe(1);
    expect(m.thickArea).toBe(1);
    expect(m.okArea).toBe(7);
    expect(m.meanThickness).toBeCloseTo((7 * 0.2 + 0.12 + 0.26) / 9, 9);
    // the thin cell (row 4 from the south, col 3) and its 3 × 3 average
    const thinCell = 4 * nx + 3;
    expect(m.state[thinCell]).toBe(LayerCell.Thin);
    expect(m.state[0]).toBe(LayerCell.Bare);
    expect(m.state[1 * nx + 1]).toBe(LayerCell.Edge);
    // 3 × 3 averages over inside cells only (edge cells read low), needing 5 of them: the
    // centre (all 9) and the four edge-middles (6 each); the lowest is the west-middle
    expect(m.thinnest).toBeCloseTo((5 * 0.2 + 0.12) / 6, 9);
    expect(m.thickest).toBeCloseTo((5 * 0.2 + 0.26) / 6, 9);
    expect(m.patches).toHaveLength(1);
    expect(m.patches[0]).toMatchObject({ cells: 1, area: 1, bbox: [3, 4, 3, 4] });
  });

  test("the thinnest spot is a 3 × 3 average, so one noisy cell doesn't decide it", () => {
    const nx = 9, ny = 9;
    const base = new Float64Array(nx * ny).fill(0);
    const at = new Float64Array(nx * ny).fill(0.2);
    at[4 * nx + 4] = 0.11; // one low cell in the middle of a big, even layer
    const m = measureLayer({ nx, ny, cell: 1 }, base, at, all(nx * ny), LAYER);
    expect(m.edgeArea).toBe(0); // fills the whole grid: the grid's border isn't the layer's edge
    expect(m.thinArea).toBe(1);
    expect(m.thinnest).toBeCloseTo((8 * 0.2 + 0.11) / 9, 9); // 0.19
    expect(m.thickest).toBeCloseTo(0.2, 9);
  });

  test("cells not scanned in both flights are left out", () => {
    const base = Float64Array.from([0, 0, NaN, 0]);
    const at = Float64Array.from([0.2, NaN, 0.2, 0.2]);
    const m = measureLayer({ nx: 2, ny: 2, cell: 2 }, base, at, all(4), { ...LAYER, density_t_m3: null });
    expect(m.measuredArea).toBe(8);
    expect(m.placedArea).toBe(8);
    expect(m.volume).toBeCloseTo(2 * 0.2 * 4, 9);
    expect(m.tonnes).toBeNull();
    expect(m.state[1]).toBe(LayerCell.None);
  });

  test("base flight: the one set, else the flight before the layer first appears", () => {
    const flat = (z: number) => new Float64Array(4).fill(z);
    const s = { nx: 2, ny: 2, cell: 1, x0: 0, y0: 0, design: null, scans: [flat(5), flat(5.01), flat(5.2), flat(5.2)], dates: ["a", "b", "c", "d"] } as Surfaces;
    const scans = ["p0", "p1", "p2", "p3"].map((project_id, k) => ({ project_id, date: s.dates[k] }));
    const layer: Layer = { id: "l", name: "Base", material: "", polygon: [], base_scan: null, ...LAYER };
    expect(resolveBaseScan(layer, s, scans, all(4))).toEqual({ index: 1, auto: true });
    expect(resolveBaseScan({ ...layer, base_scan: "p0" }, s, scans, all(4))).toEqual({ index: 0, auto: false });
    expect(resolveBaseScan({ ...layer, base_scan: "gone" }, s, scans, all(4))).toEqual({ index: null, auto: false });
    const never = { ...s, scans: [flat(5), flat(5), flat(5)] } as Surfaces;
    expect(resolveBaseScan(layer, never, scans, all(4)).index).toBeNull();
  });

  test("material presets match saved names and aliases", () => {
    expect(layerPreset("Aggregate base")?.density).toBe(2.24);
    expect(layerPreset("asphalt")?.density).toBe(2.32);
    expect(layerPreset("Mulch")).toBeNull();
    expect(layerPreset("")).toBeNull();
  });

  test("thin lifts are flagged as unreliable from a drone", () => {
    expect(layerReliability(0.05)).toBe("poor"); // 2 in asphalt
    expect(layerReliability(0.1)).toBe("fair"); // 4 in
    expect(layerReliability(0.2)).toBe("good"); // 8 in base
  });
});

describe("stockpile materials", () => {
  test("each class is recognised from its colour and intensity", () => {
    expect(classifySample({ rgb: [68, 52, 39], intensity: 5 })).toBe("topsoil");
    expect(classifySample({ rgb: [151, 150, 148], intensity: 250 })).toBe("aggregate");
    expect(classifySample({ rgb: [147, 103, 70], intensity: 80 })).toBe("spoil");
    expect(classifySample({ rgb: null, intensity: 240 })).toBe("aggregate"); // intensity alone
    expect(classifySample({ rgb: [40, 200, 250], intensity: null })).toBeNull(); // looks like none of them
    expect(classifySample({ rgb: null, intensity: null })).toBeNull();
  });

  test("the guess is a majority vote; confidence is the winner's share", () => {
    const top = { rgb: [68, 52, 39] as [number, number, number], intensity: 10 };
    const agg = { rgb: [151, 150, 148] as [number, number, number], intensity: 240 };
    const g = guessMaterial([top, top, top, agg]);
    expect(g.material).toBe("topsoil");
    expect(g.confidence).toBe(0.75);
    expect(g.votes).toEqual({ topsoil: 3, aggregate: 1, spoil: 0 });
    expect(guessMaterial([top, top]).material).toBeNull(); // too few cells to say
  });

  test("samples come from the upper part of the pile, skipping anything standing on it", () => {
    const original = new Float64Array(4).fill(0);
    const ground = Float64Array.from([0.1, 1.0, 2.0, 2.0]);
    const none = new Float32Array(4).fill(NaN);
    const objects = Float32Array.from([NaN, NaN, NaN, 3]); // a machine on cell 3
    const photo = Uint8Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    const s = pileSamples({ photo, intensity: null, vegHeight: none, objectHeight: objects }, ground, original, all(4));
    expect(s).toEqual([
      { rgb: [2, 2, 2], intensity: null },
      { rgb: [3, 3, 3], intensity: null },
    ]);
    expect(pileSamples({ photo, intensity: null, vegHeight: none, objectHeight: none }, original, original, all(4))).toEqual([]);
  });
});

describe("pond storage", () => {
  // a 3 × 3 pond of 2 m cells: floor 100 in the middle, 101 around, outlet 101.5
  const z = grid([
    [101, 101, 101],
    [101, 100, 101],
    [101, 101, 101],
  ]);

  test("volume below an elevation sums the depth over each cell", () => {
    expect(storageBelow(z, all(9), 4, 101.5)).toBeCloseTo(4 * (1.5 + 8 * 0.5), 9); // 22 m³
    expect(storageBelow(z, all(9), 4, 100.5)).toBeCloseTo(2, 9);
    expect(storageBelow(z, all(9), 4, 99)).toBe(0);
  });

  test("stage–storage from the floor to the outlet", () => {
    const st = stageStorage(z, all(9), 4, 101.5, stageLevels(100, 101.5, 3));
    expect(st.floor).toBe(100);
    expect(st.storage).toBeCloseTo(22, 9);
    expect(st.curve.map((p) => p.elevation)).toEqual([100, 100.5, 101, 101.5]);
    expect(st.curve.map((p) => p.volume)).toEqual([0, 2, 4, 22]);
    expect(st.unseenArea).toBe(0);
  });

  test("ground under standing water isn't guessed: it's reported, with how much it could add", () => {
    const wet = Float64Array.from(z);
    wet[4] = NaN; // no return from the water over the floor
    const st = stageStorage(wet, all(9), 4, 101.5, [101.5]);
    expect(st.storage).toBeCloseTo(16, 9); // the eight rim cells only
    expect(st.floor).toBe(101);
    expect(st.unseenArea).toBe(4);
    expect(st.unseenUpTo).toBeCloseTo(4 * 0.5, 9); // if it were as low as the lowest ground seen
  });

  test("the lowest point on the zone's edge is where it would spill", () => {
    const rim = Float64Array.from(z);
    rim[1] = 100.8; // south edge, middle
    const cells = all(9);
    expect(lowestRim(rim, { nx: 3, ny: 3, cell: 1 }, cells)).toBe(100.8);
  });
});
