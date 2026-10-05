import { describe, expect, test } from "vitest";
import { balancedBase, designGrid, haul, siteCells, volumes, type SiteCells } from "./earthworks";

// 2 × 2 grid of 1 m cells: elevations 0, 1, 2, 3 m (row-major, row 0 = south)
const GRID = { x: [0.5, 1.5], y: [0.5, 1.5], z: [[0, 1], [2, 3]], mask: [[1, 1], [1, 1]] };
const cells = (): SiteCells => siteCells(GRID, 1);

describe("siteCells", () => {
  test("keeps only scanned cells, with their positions and area", () => {
    const masked = siteCells({ ...GRID, mask: [[1, 0], [0, 1]] }, 2);
    expect(Array.from(masked.z)).toEqual([0, 3]);
    expect(Array.from(masked.x)).toEqual([0.5, 1.5]);
    expect(masked.cellArea).toBe(4);
  });
});

describe("designGrid", () => {
  test("a flat pad is the same height everywhere", () => {
    const t = designGrid(cells(), { base: 1.5, slopePct: 0, fallsTowardDeg: 0 });
    expect(Array.from(t)).toEqual([1.5, 1.5, 1.5, 1.5]);
  });

  test("a 10% fall toward north drops 0.1 m per metre north of the centre", () => {
    const t = designGrid(cells(), { base: 1.5, slopePct: 10, fallsTowardDeg: 0 });
    // centre is (1, 1); southern row is 0.5 m south → 0.05 m higher
    expect(t[0]).toBeCloseTo(1.55, 6);
    expect(t[2]).toBeCloseTo(1.45, 6);
  });

  test("a fall toward east drops eastward", () => {
    const t = designGrid(cells(), { base: 0, slopePct: 10, fallsTowardDeg: 90 });
    expect(t[1]).toBeLessThan(t[0]);
  });
});

describe("volumes", () => {
  test("cut above the pad, fill below it, in m³ with areas and depths", () => {
    const v = volumes(cells(), designGrid(cells(), { base: 1.5, slopePct: 0, fallsTowardDeg: 0 }));
    expect(v.cut).toBeCloseTo(0.5 + 1.5, 6);
    expect(v.fill).toBeCloseTo(1.5 + 0.5, 6);
    expect(v.cutArea).toBe(2);
    expect(v.fillArea).toBe(2);
    expect(v.maxCut).toBeCloseTo(1.5, 6);
    expect(v.maxFill).toBeCloseTo(1.5, 6);
  });
});

describe("balancedBase", () => {
  test("without compaction the balanced flat pad is the mean elevation", () => {
    expect(balancedBase(cells(), { slopePct: 0, fallsTowardDeg: 0 }, 0)).toBeCloseTo(1.5, 4);
  });

  test("with shrinkage the pad sits lower, so cut covers the extra compacted fill", () => {
    const base = balancedBase(cells(), { slopePct: 0, fallsTowardDeg: 0 }, 0.2);
    const v = volumes(cells(), designGrid(cells(), { base, slopePct: 0, fallsTowardDeg: 0 }));
    expect(base).toBeLessThan(1.5);
    expect(v.cut).toBeCloseTo(v.fill / (1 - 0.2), 3);
  });
});

describe("haul", () => {
  const material = { swellPct: 25, shrinkPct: 10 };

  test("surplus cut is exported as loose, swollen volume in whole truckloads", () => {
    const h = haul({ cut: 100, fill: 45 }, material, 10);
    expect(h.fillBank).toBeCloseTo(50, 6); // 45 compacted needs 50 bank
    expect(h.direction).toBe("export");
    expect(h.bank).toBeCloseTo(50, 6); // 100 − 50 left over
    expect(h.loose).toBeCloseTo(62.5, 6); // swells 25 %
    expect(h.loads).toBe(7);
  });

  test("a shortfall is imported", () => {
    const h = haul({ cut: 10, fill: 90 }, material, 10);
    expect(h.direction).toBe("import");
    expect(h.bank).toBeCloseTo(90, 6); // 100 bank needed − 10 available
    expect(h.loose).toBeCloseTo(112.5, 6);
    expect(h.loads).toBe(12);
  });

  test("near-zero difference counts as balanced", () => {
    const h = haul({ cut: 50, fill: 45 }, material, 10);
    expect(h.direction).toBe("balanced");
    expect(h.loads).toBe(0);
  });
});
