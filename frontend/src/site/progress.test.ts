import { describe, expect, test } from "vitest";
import {
  checkPayApp,
  cutFill,
  dayNumber,
  fromDayNumber,
  overallPct,
  plannedPct,
  zoneCells,
  zoneProgress,
  type Surfaces,
} from "./progress";
import type { PayApp, Zone } from "./types";

// 10 x 10 m grid of 1 m cells, south-west corner at (1000, 5000); design is flat at 100 m.
const N = 10;
const grid = { nx: N, ny: N, cell: 1, x0: 1000, y0: 5000 };
const surface = (f: (col: number, row: number) => number) =>
  Float64Array.from({ length: N * N }, (_, i) => f(i % N, Math.floor(i / N)));
const westHalf: [number, number][] = [
  [1000, 5000],
  [1005, 5000],
  [1005, 5010],
  [1000, 5010],
];
const settings = { tolerance_m: 0.05, change_threshold_m: 0.05, overbill_pct: 10 };

function site(heights: number[], dates: string[]): Surfaces {
  // the west half starts high and is cut down toward design; the east half is already on grade
  return {
    ...grid,
    design: surface(() => 100),
    scans: heights.map((h) => surface((c) => (c < 5 ? 100 + h : 100))),
    dates,
  };
}

const zone = (patch: Partial<Zone> = {}): Zone => ({
  id: "w",
  name: "West",
  kind: "grading",
  color: "#ff7a1a",
  polygon: westHalf,
  start: null,
  finish: null,
  ...patch,
});

describe("zoneCells", () => {
  test("keeps the cells whose centres fall inside the polygon", () => {
    const cells = Array.from(zoneCells(grid, westHalf));
    expect(cells).toHaveLength(50);
    expect(cells.every((i) => i % N < 5)).toBe(true);
  });

  test("a null polygon is the whole site", () => {
    expect(zoneCells(grid, null)).toHaveLength(N * N);
  });
});

describe("cutFill", () => {
  test("ignores differences inside the deadband and unmeasured cells", () => {
    const a = Float64Array.from([1, -2, 0.03, NaN]);
    const b = new Float64Array(4);
    expect(cutFill(a, b, Int32Array.from([0, 1, 2, 3]), 2, 0.05)).toEqual({ cut: 2, fill: 4, area: 6 });
  });
});

describe("zoneProgress", () => {
  test("tracks earthworks done, earth moved per period and when the zone finished", () => {
    const s = site([1, 0.5, 0.02], ["2026-09-01", "2026-09-08", "2026-09-15"]);

    const p = zoneProgress(s, zone({ start: "2026-09-01", finish: "2026-09-30" }), settings);

    expect(p.baseline).toBeCloseTo(50); // 50 cells, 1 m above design
    expect(p.snapshots.map((x) => x.pct)).toEqual([0, 50, 100]); // last scan is within tolerance
    expect(p.snapshots.map((x) => +x.cut.toFixed(6))).toEqual([0, 25, 24]);
    expect(p.snapshots[2].onGradePct).toBe(100);
    expect(p.status).toBe("done");
    expect(p.doneOn).toBe("2026-09-15");
  });

  test("forecasts the finish from the recent trend and compares it with the plan", () => {
    const dates = ["2026-09-01", "2026-09-08", "2026-09-15"];
    const s = site([1, 0.8, 0.6], dates); // 20 % a week: 60 % left takes 21 more days

    const onTime = zoneProgress(s, zone({ start: "2026-09-01", finish: "2026-10-10" }), settings);
    const late = zoneProgress(s, zone({ start: "2026-09-01", finish: "2026-09-30" }), settings);

    expect(onTime.forecast).toBe("2026-10-06");
    expect(onTime.status).toBe("on-track");
    expect(late.status).toBe("behind");
    expect(late.scheduleGap).toBeCloseTo(40 - (100 * 14) / 29);
  });

  test("a trend too slow to finish within two years is stalled, with no forecast", () => {
    const s = site([1, 0.999, 0.99], ["2026-09-01", "2026-09-08", "2026-09-15"]);
    const p = zoneProgress(s, zone({ start: "2026-09-01", finish: "2026-10-30" }), settings);
    expect(p.forecast).toBeNull();
    expect(p.status).toBe("stalled");
  });

  test("a zone with no progress since the last scans is stalled", () => {
    const s = site([1, 0.8, 0.8, 0.8], ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"]);
    expect(zoneProgress(s, zone({ start: "2026-09-01", finish: "2026-10-30" }), settings).status).toBe("stalled");
  });

  test("a stockpile reports the volume piled on the original ground", () => {
    const s = site([0, 2, 0.5], ["2026-09-01", "2026-09-08", "2026-09-15"]);
    const p = zoneProgress(s, zone({ kind: "stockpile" }), settings);
    expect(p.snapshots.map((x) => x.pileVolume)).toEqual([0, 100, 25]);
    expect(p.status).toBe("unplanned");
  });
});

describe("checkPayApp", () => {
  const s = site([1, 0.5, 0.2], ["2026-09-01", "2026-09-08", "2026-09-15"]);
  const zones = [zone()];
  const claim = (claimed: number, date = "2026-09-15"): PayApp => ({
    id: "p", date, zone_id: "w", kind: "cut", claimed_m3: claimed, contractor: "", note: "",
  });

  test("measures the period ending at the claim's scan and flags over-billing", () => {
    const fair = checkPayApp(s, claim(16), zones, settings); // measured 15 m³ (0.3 m × 50 m²)
    const over = checkPayApp(s, claim(20), zones, settings);

    expect(fair.measured).toBeCloseTo(15);
    expect(fair.fromDate).toBe("2026-09-08");
    expect(fair.flagged).toBe(false);
    expect(over.diffPct).toBeCloseTo(33.33, 1);
    expect(over.flagged).toBe(true);
  });

  test("a claim dated before any measured period can't be checked", () => {
    expect(checkPayApp(s, claim(10, "2026-09-03"), zones, settings).measured).toBeNull();
  });
});

describe("schedule helpers", () => {
  test("planned progress runs linearly from start to finish", () => {
    const z = { start: "2026-09-01", finish: "2026-09-11" };
    expect(plannedPct(z, "2026-08-20")).toBe(0);
    expect(plannedPct(z, "2026-09-06")).toBe(50);
    expect(plannedPct(z, "2026-10-01")).toBe(100);
    expect(plannedPct({ start: null, finish: null }, "2026-09-06")).toBeNull();
  });

  test("day numbers round-trip without time-zone drift", () => {
    expect(fromDayNumber(dayNumber("2026-03-29"))).toBe("2026-03-29");
    expect(dayNumber("2026-09-08") - dayNumber("2026-09-01")).toBe(7);
  });

  test("overall progress weights zones by the earthworks they started with", () => {
    const big = zoneProgress(site([1, 0.5], ["2026-09-01", "2026-09-08"]), zone(), settings); // 50 m³, half done
    const small = { ...big, baseline: 10, snapshots: big.snapshots.map((x) => ({ ...x, pct: 100 })) };
    expect(overallPct([big, small])).toBeCloseTo((25 + 10) / 60 * 100);
  });
});
