import { describe, expect, test } from "vitest";
import { jobsiteSummary } from "./summary";

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
  });
});
