import { describe, expect, it } from "vitest";
import {
  ACRE_M2,
  MARK,
  cellMask,
  conditionsLayer,
  coverageColour,
  markedArea,
  needsStormwaterPermit,
  outsideLimits,
  pondSediment,
  rillSeverity,
  stormFindings,
  vegetationColour,
  zoneAt,
  type FlightConditions,
} from "./conditions";
import { zoneCells } from "./progress";

// a 6 x 5 grid of 1 m cells, south-west corner at (0, 0)
const G = { nx: 6, ny: 5, cell: 1, x0: 0, y0: 0, threshold: 0.05 };
const cells = G.nx * G.ny;

describe("limits of disturbance", () => {
  it("counts disturbed cells outside the drawn limits", () => {
    const marks = new Uint8Array(cells);
    for (let r = 1; r <= 3; r++) for (let c = 2; c <= 5; c++) marks[r * G.nx + c] = MARK.MOVED; // 12 cells
    marks[0] = MARK.CLEARED; // cleared, inside
    marks[4 * G.nx + 5] = MARK.CLEARED; // cleared, outside (top-right)
    const lod = cellMask(zoneCells(G, [[0, 0], [4, 0], [4, 3], [0, 3]]), cells); // columns 0-3, rows 0-2
    const out = outsideLimits(marks, lod, 1)!;
    // moved outside: columns 4-5 of rows 1-3 (6) + row 3 columns 2-3 (2) = 8, plus 1 cleared
    expect(out.movedOutside_m2).toBe(8);
    expect(out.outside_m2).toBe(9);
    expect(out.outside.reduce((a, b) => a + b, 0)).toBe(9);
    expect(outsideLimits(marks, null, 1)).toBeNull();
  });

  it("measures marked areas inside and outside a region", () => {
    const marks = Uint8Array.from([1, 1, 2, 0, 4, 1]);
    const region = Uint8Array.from([1, 0, 1, 1, 0, 0]);
    expect(markedArea(marks, MARK.MOVED, 2)).toBe(6);
    expect(markedArea(marks, MARK.MOVED | MARK.CLEARED, 2, region)).toBe(4);
    expect(markedArea(marks, MARK.MOVED, 2, region, true)).toBe(4);
  });

  it("flags the one-acre stormwater permit line", () => {
    expect(needsStormwaterPermit(ACRE_M2 - 1)).toBe(false);
    expect(needsStormwaterPermit(ACRE_M2)).toBe(true);
  });
});

describe("pond sediment", () => {
  it("is the silt area in the pond, with the measurable rise as volume", () => {
    const big = { ...G, nx: 10, ny: 10 };
    const marks = new Uint8Array(100);
    const pond = new Uint8Array(100);
    const before = new Float64Array(100).fill(10);
    const now = new Float64Array(100).fill(10);
    for (let i = 0; i < 40; i++) pond[i] = 1; // the southern 4 rows are the pond
    for (let i = 0; i < 12; i++) marks[i] = MARK.SEDIMENT; // 12 m² of silt...
    for (let i = 0; i < 5; i++) now[i] = 10.08; // ...5 m² of it measurably 8 cm higher
    marks[90] = MARK.SEDIMENT; // outside the pond: not counted
    const s = pondSediment(big, marks, pond, now, before, 0)!;
    expect(s.area_m2).toBe(12);
    expect(s.measured_m3).toBeCloseTo(0.4, 6);
    // centre: columns 0-9 of row 0 and 0-1 of row 1 → mean column 46/12, mean row 2/12, + half a cell
    expect(s.e).toBeCloseTo(46 / 12 + 0.5, 6);
    expect(s.n).toBeCloseTo(2 / 12 + 0.5, 6);
    expect(pondSediment(big, marks, pond, now, before, 0.08)!.measured_m3).toBe(0); // a whole-flight offset isn't silt
    const few = new Uint8Array(100);
    few[0] = MARK.SEDIMENT;
    expect(pondSediment(big, few, pond, null, null, 0)).toBeNull(); // under 10 m²: noise
  });
});

describe("storm findings", () => {
  const flight = (rills: { depth_m: number; length_m: number }[]): FlightConditions => ({
    project_id: "f",
    date: "2026-10-19",
    classified: true,
    has_color: true,
    has_intensity: true,
    offset_vs_first_m: 0,
    vegetation: { canopy_m2: 0, brush_m2: 0, trees: 0, canopy_patches: 0, brush_patches: 0 },
    cleared_since_previous_m2: 0,
    machines: [],
    disturbed: { moved_m2: 0, cleared_m2: 0, total_m2: 0 },
    coverage: { covered_m2: 1, thin_m2: 0, ground_per_m2: 4 },
    storm: {
      rills: rills.map((r, i) => ({ ...r, e: 2 + i, n: 2, line: [[2, 1], [2, 3]], width_m: 0.5, mean_depth_m: r.depth_m / 2, volume_m3: 0.5, worked: false })),
      water: [{ e: 50, n: 50, area_m2: 64 }],
      offset_m: 0,
      dark_m2: 0,
    },
  });
  const site = { zones: [{ id: "p", name: "Parking lot", kind: "grading" as const, color: "#000000", polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][], start: null, finish: null }] };

  it("grades rills: 15 cm deep or 10 m long needs repair", () => {
    expect(rillSeverity({ depth_m: 0.2, length_m: 4 })).toBe("repair");
    expect(rillSeverity({ depth_m: 0.1, length_m: 12 })).toBe("repair");
    expect(rillSeverity({ depth_m: 0.1, length_m: 5 })).toBe("watch");
  });

  it("lists repairs first and names the zone", () => {
    const f = stormFindings(site, flight([{ depth_m: 0.1, length_m: 5 }, { depth_m: 0.25, length_m: 6 }]), [])!;
    expect(f.map((x) => x.kind)).toEqual(["rill", "rill", "water"]);
    expect(f[0].severity).toBe("repair");
    expect(f[0].rill!.depth_m).toBe(0.25);
    expect(f[0].where).toBe("Parking lot");
    expect(f[2].where).toBeNull();
    expect(zoneAt(site, 5, 5)).toBe("Parking lot");
  });
});

describe("map layers", () => {
  it("colours vegetation by height and leaves grass out", () => {
    expect(vegetationColour(NaN)).toBeNull();
    expect(vegetationColour(0.2)).toBeNull();
    expect(vegetationColour(1.0)![1]).toBeGreaterThan(200); // brush: light green
    expect(vegetationColour(20)![1]).toBeLessThan(vegetationColour(2)![1]); // taller trees darker
  });

  it("flags thin coverage under 1 and 2 ground points per m²", () => {
    expect(coverageColour(0, 1, true)![0]).toBeGreaterThan(200); // red
    expect(coverageColour(1, 1, true)).not.toEqual(coverageColour(0, 1, true));
    expect(coverageColour(4, 1, true)).toBeNull();
    expect(coverageColour(0, 1, false)).toBeNull(); // not flown: not this flight's fault
    expect(coverageColour(3, 4, true)).not.toBeNull(); // 3 points in a 2 m cell is under 1 / m²
  });

  it("paints disturbed ground, red outside the limits", () => {
    const marks = Uint8Array.from([MARK.MOVED, MARK.CLEARED, 0, MARK.MOVED]);
    const outside = Uint8Array.from([0, 0, 0, 1]);
    const layer = conditionsLayer({ kind: "disturbed", cells: 4, cellArea: 1, marks, outside })!;
    expect(layer[2 * 4 + 3]).toBe(0); // untouched cell left clear
    expect(layer[3 * 4]).toBe(229); // outside: red
    expect(layer[3 * 4 + 1]).toBeLessThan(100);
    expect(conditionsLayer({ kind: "photo", cells: 4, cellArea: 1, photo: null })).toBeNull();
  });
});
