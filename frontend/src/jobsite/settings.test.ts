import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setUnitSystem } from "../lib/units";
import { DEFAULT_JOBSITE, parseJobsite } from "./settings";

beforeEach(() => setUnitSystem("metric"));
afterEach(() => setUnitSystem("us")); // back to the default

describe("parseJobsite", () => {
  test("restores valid saved settings", () => {
    const saved = { ...DEFAULT_JOBSITE, mode: "custom", customBase: 12.5, slopePct: 2, fallsTowardDeg: 90 };
    expect(parseJobsite(saved)).toEqual(saved);
  });

  test("falls back to defaults for missing or nonsense values", () => {
    expect(parseJobsite(null)).toEqual(DEFAULT_JOBSITE);
    expect(parseJobsite({ mode: "dig", swellPct: "lots", truckM3: -4 })).toEqual({ ...DEFAULT_JOBSITE, truckM3: 1 });
  });

  test("keeps slopes and factors within sensible limits", () => {
    const p = parseJobsite({ slopePct: 90, shrinkPct: 99, swellPct: 400 });
    expect([p.slopePct, p.shrinkPct, p.swellPct]).toEqual([20, 50, 100]);
  });

  test("a first truck is 10 of the user's volume unit, stored in m³", () => {
    setUnitSystem("us");
    expect(parseJobsite(null).truckM3).toBeCloseTo(7.6455, 4); // 10 yd³
    expect(parseJobsite({ truckM3: 12 }).truckM3).toBe(12); // a saved size is never reinterpreted
  });
});
