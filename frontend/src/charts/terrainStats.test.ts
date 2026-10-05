import { describe, expect, test } from "vitest";
import { aspectRose, earthworksCurve, maskedValues, percentAtOrBelow, slopeClasses } from "./terrainStats";

describe("maskedValues", () => {
  test("keeps only scanned cells", () => {
    expect(maskedValues([[1, 2], [3, 4]], [[1, 0], [0, 1]])).toEqual([1, 4]);
  });

  test("treats a missing mask as fully scanned", () => {
    expect(maskedValues([[1, 2]], undefined)).toEqual([1, 2]);
  });
});

describe("percentAtOrBelow", () => {
  test("is the share of values at or under the threshold", () => {
    expect(percentAtOrBelow([1, 2, 3, 4], 2)).toBe(50);
    expect(percentAtOrBelow([], 2)).toBe(0);
  });
});

describe("earthworksCurve", () => {
  // two 1 m² cells at 0 m and 2 m
  const z = [0, 2];

  test("cut falls and fill rises as the pad is raised", () => {
    const c = earthworksCurve(z, 1, 5);
    expect(c.levels[0]).toBe(0);
    expect(c.levels[4]).toBe(2);
    expect(c.cut[0]).toBe(2); // pad at 0: dig 2 m from the high cell
    expect(c.fill[0]).toBe(0);
    expect(c.cut[4]).toBe(0);
    expect(c.fill[4]).toBe(2);
  });

  test("finds the pad height where cut equals fill, and the volume moved", () => {
    const c = earthworksCurve(z, 1, 5);
    expect(c.balance).toBeCloseTo(1, 6);
    expect(c.moved).toBeCloseTo(1, 6); // 1 m off the high cell into the low one
  });

  test("scales volumes by cell area", () => {
    expect(earthworksCurve(z, 0.5, 3).cut[0]).toBeCloseTo(0.5, 6); // 2 m × 0.25 m²
  });
});

describe("slopeClasses", () => {
  test("splits slopes into classes as percentages of the site", () => {
    const classes = slopeClasses([1, 1, 3, 12], [0, 2, 5, 10, 15, Infinity]);
    expect(classes.map((c) => c.pct)).toEqual([50, 25, 0, 25, 0]);
  });
});

describe("aspectRose", () => {
  test("bins slope directions into compass sectors, ignoring flat ground", () => {
    // aspect (deg clockwise from N) with slopes; the 0.5° cell is flat and skipped
    const rose = aspectRose([0, 10, 90, 180, 270], [5, 5, 5, 0.5, 5], 4, 1);
    expect(rose.fractions).toEqual([0.5, 0.25, 0, 0.25]); // N, E, S, W
    expect(rose.flatPct).toBe(20);
  });

  test("sector 0 is centred on north (wraps 350° into N)", () => {
    expect(aspectRose([350], [5], 4, 1).fractions[0]).toBe(1);
  });
});
