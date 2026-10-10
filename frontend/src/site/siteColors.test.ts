import { describe, expect, test } from "vitest";
import { CUT, FILL, ON_GRADE, siteTint, tintScale, workMask } from "./siteColors";

describe("siteTint", () => {
  test("vs design: above is still to dig (red), below still to fill (blue)", () => {
    expect(siteTint("design", 0.5, 0.05, 1, true)?.rgb).toBe(CUT);
    expect(siteTint("design", -0.5, 0.05, 1, true)?.rgb).toBe(FILL);
  });

  test("since last scan: ground that went down was dug (red), up was placed (blue)", () => {
    expect(siteTint("change", -0.5, 0.05, 1, false)?.rgb).toBe(CUT);
    expect(siteTint("change", 0.5, 0.05, 1, false)?.rgb).toBe(FILL);
  });

  test("on grade is green only where work was needed; untouched ground and noise stay plain", () => {
    expect(siteTint("design", 0.02, 0.05, 1, true)?.rgb).toBe(ON_GRADE);
    expect(siteTint("design", 0.02, 0.05, 1, false)).toBeNull();
    expect(siteTint("change", 0.02, 0.05, 1, false)).toBeNull();
    expect(siteTint("design", NaN, 0.05, 1, true)).toBeNull();
  });

  test("strength grows with the difference up to the scale", () => {
    const small = siteTint("design", 0.1, 0.05, 1, true)!.t;
    const big = siteTint("design", 5, 0.05, 1, true)!.t;
    expect(small).toBeLessThan(big);
    expect(big).toBeCloseTo(0.95);
  });
});

describe("helpers", () => {
  test("work mask marks cells off design at the first scan", () => {
    const mask = workMask(Float64Array.from([1, 1.02, NaN]), Float64Array.from([0, 1, 1]), 0.05);
    expect(Array.from(mask!)).toEqual([1, 0, 0]);
    expect(workMask(Float64Array.from([1]), null, 0.05)).toBeNull();
  });

  test("colour scale is the 98th percentile, never under 25 cm", () => {
    expect(tintScale([])).toBe(0.25);
    expect(tintScale([0.01, 0.02])).toBe(0.25);
    expect(tintScale(Array.from({ length: 100 }, (_, i) => i / 10))).toBeCloseTo(9.8);
  });
});
