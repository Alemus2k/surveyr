import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { setUnitSystem } from "../lib/units";
import { jobsiteSummary } from "./summary";

beforeEach(() => setUnitSystem("metric"));
afterEach(() => setUnitSystem("us")); // back to the default

const base = {
  project: "Back garden",
  padElevation: 12.345,
  balanced: true,
  slopePct: 0,
  fallsToward: "North",
  scannedArea: 120,
  cellSize: 0.25,
  volumes: { cut: 30.12, fill: 27.4, cutArea: 60, fillArea: 55, maxCut: 0.42, maxFill: 0.31 },
  material: { label: "Common earth", swellPct: 25, shrinkPct: 10 },
  haul: { fillBank: 30.44, direction: "balanced" as const, bank: 0, loose: 0, loads: 0 },
  truckM3: 10,
};

describe("jobsiteSummary", () => {
  test("states the pad, volumes, material and outcome in plain text", () => {
    const text = jobsiteSummary(base);
    expect(text).toContain("Back garden");
    expect(text).toContain("Balanced pad at 12.35 m");
    expect(text).toContain("Cut: 30.1 m³");
    expect(text).toContain("Fill: 27.4 m³");
    expect(text).toContain("Common earth (swell 25%, shrinkage 10%)");
    expect(text).toContain("Balanced on site");
    expect(text).toMatch(/estimates/i);
  });

  test("describes exports with truckloads and any drainage fall", () => {
    const text = jobsiteSummary({
      ...base,
      balanced: false,
      slopePct: 2,
      fallsToward: "East",
      haul: { fillBank: 10, direction: "export", bank: 40, loose: 50, loads: 5 },
    });
    expect(text).toContain("Pad at 12.35 m, falling 2% toward East");
    expect(text).toContain("Export 50.0 m³ loose (40.0 m³ in the ground) ≈ 5 loads of 10 m³");
    expect(text).toContain("Dirt balance: 30.1 m³ dug − 10.0 m³ used to fill depressions = 20.1 m³ left over to remove");
  });

  test("reads in feet and cubic yards in US units", () => {
    setUnitSystem("us");
    const text = jobsiteSummary({ ...base, haul: { fillBank: 10, direction: "export", bank: 40, loose: 50, loads: 5 } });
    expect(text).toContain("Balanced pad at 40.50 ft"); // 12.345 / 0.3048
    expect(text).toContain("Cut: 39.4 yd³"); // 30.12 / 0.7645549
    expect(text).toContain("(grid 0.82 ft)");
    expect(text).toContain("deepest 1.38 ft"); // 0.42 / 0.3048
    expect(text).toContain("≈ 5 loads of 13.08 yd³"); // a 10 m³ truck
    expect(text).not.toMatch(/ m\b|m³|m²/);
  });
});
