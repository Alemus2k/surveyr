import { describe, expect, test } from "vitest";
import { zoneCells, zoneProgress, type Surfaces } from "./progress";
import {
  applySpecs,
  canVoid,
  diffSpecs,
  finishedGrade,
  issueChangeOrder,
  meanOver,
  nextChangeOrderNumber,
  planVoid,
  specsOf,
  voidChangeOrder,
} from "./specs";
import type { Site, Zone } from "./types";

// 10 x 10 m grid of 1 m cells at (0, 0); design flat at 100 m, west half scanned at 101 m.
const N = 10;
const cellAt = (f: (col: number) => number) => Float64Array.from({ length: N * N }, (_, i) => f(i % N));
const surfaces = (design: Float64Array | null = cellAt(() => 100)): Surfaces => ({
  nx: N, ny: N, cell: 1, x0: 0, y0: 0,
  design,
  scans: [cellAt((c) => (c < 5 ? 101 : 100))],
  dates: ["2026-09-07"],
});
const west: [number, number][] = [[0, 0], [5, 0], [5, 10], [0, 10]];
const zone = (patch: Partial<Zone> = {}): Zone => ({
  id: "w", name: "West", kind: "grading", color: "#ff7a1a", polygon: west, start: null, finish: null, ...patch,
});
const site = (zones: Zone[] = [zone()]): Site => ({
  version: 1, name: "Lot", scans: [{ project_id: "s1", date: "2026-09-07" }], design_id: "dsg",
  tolerance_m: 0.05, change_threshold_m: 0.05, overbill_pct: 10, control_id: null, zones, pay_apps: [],
});
const cellsOf = (z: Zone) => zoneCells(surfaces(), z.polygon);
const names = (id: string) => ({ dsg: "Design v1", dsg2: "Design v2" })[id] ?? id;

describe("finished grade", () => {
  test("is the design surface when no zone has a grade spec", () => {
    const s = surfaces();
    expect(finishedGrade(s, [zone()], cellsOf)).toBe(s.design);
  });

  test("a flat pad replaces the design inside its zone only", () => {
    const g = finishedGrade(surfaces(), [zone({ target_elevation_m: 101 })], cellsOf)!;
    expect(g[0]).toBe(101); // west
    expect(g[9]).toBe(100); // east keeps the design
  });

  test("an offset raises the design inside its zone", () => {
    const g = finishedGrade(surfaces(), [zone({ design_offset_m: 0.5 })], cellsOf)!;
    expect(g[0]).toBeCloseTo(100.5);
    expect(g[9]).toBe(100);
  });

  test("a flat pad gives a zone a grade even without a design surface", () => {
    const g = finishedGrade(surfaces(null), [zone({ target_elevation_m: 101 })], cellsOf)!;
    expect(g[0]).toBe(101);
    expect(g[9]).toBeNaN();
  });

  test("raising the pad to the scanned height makes the zone complete", () => {
    const s = surfaces();
    const z = zone({ target_elevation_m: 101 });
    const before = zoneProgress(s, z, site());
    const after = zoneProgress({ ...s, design: finishedGrade(s, [z], cellsOf) }, z, site());
    expect(before.snapshots[0].remainingCut).toBeCloseTo(50); // 50 cells, 1 m above design
    expect(after.snapshots[0].remainingCut).toBe(0);
    expect(after.snapshots[0].onGradePct).toBe(100);
  });

  test("mean elevation skips unmeasured cells", () => {
    expect(meanOver(Float64Array.from([1, NaN, 3]), Int32Array.from([0, 1, 2]))).toBe(2);
    expect(meanOver(Float64Array.from([NaN]), Int32Array.from([0]))).toBeNull();
  });
});

describe("change orders", () => {
  test("an unchanged draft has no changes", () => {
    expect(diffSpecs(site(), specsOf(site()), names)).toEqual([]);
  });

  test("the diff words each edited spec before and after", () => {
    const draft = specsOf(site());
    draft.design_id = "dsg2";
    draft.tolerance_m = 0.03;
    draft.zones[0] = { ...draft.zones[0], target_elevation_m: 101.25, finish: "2026-11-30" };

    expect(diffSpecs(site(), draft, names)).toEqual([
      { field: "design_id", zone_id: null, zone_name: null, before: "Design v1", after: "Design v2", values: { before: "dsg", after: "dsg2" } },
      { field: "tolerance_m", zone_id: null, zone_name: null, before: "±5 cm", after: "±3 cm", values: { before: 0.05, after: 0.03 } },
      {
        field: "grade", zone_id: "w", zone_name: "West", before: "Design surface", after: "Flat pad at 101.250 m",
        values: { before: { target_elevation_m: null, design_offset_m: 0 }, after: { target_elevation_m: 101.25, design_offset_m: 0 } },
      },
      { field: "finish", zone_id: "w", zone_name: "West", before: "Not set", after: "30 Nov 2026", values: { before: null, after: "2026-11-30" } },
    ]);
  });

  test("offsets read with their sign", () => {
    const draft = specsOf(site());
    draft.zones[0].design_offset_m = -0.2;
    expect(diffSpecs(site(), draft, names)[0].after).toBe("Design surface −0.200 m");
  });

  test("applying a flat pad clears any offset; zone names and outlines are untouched", () => {
    const draft = specsOf(site([zone({ design_offset_m: 0.3 })]));
    draft.zones[0].target_elevation_m = 99;
    const z = applySpecs(site([zone({ design_offset_m: 0.3 })]), draft).zones[0];
    expect(z).toMatchObject({ target_elevation_m: 99, design_offset_m: 0, name: "West", polygon: west });
  });

  test("issuing logs a numbered order and applies the draft", () => {
    const draft = specsOf(site());
    draft.tolerance_m = 0.1;
    const changes = diffSpecs(site(), draft, names);
    const meta = { date: "2026-10-11", title: "Looser tolerance", reason: "", requested_by: "Owner" };
    const once = issueChangeOrder(site(), draft, changes, meta, new Date("2026-10-11T09:00:00Z"));
    const twice = issueChangeOrder(once, specsOf(once), changes, meta, new Date("2026-10-12T09:00:00Z"));

    expect(once.tolerance_m).toBe(0.1);
    expect(once.change_orders).toHaveLength(1);
    expect(once.change_orders![0]).toMatchObject({ number: 1, title: "Looser tolerance", created_at: "2026-10-11T09:00:00.000Z" });
    expect(twice.change_orders!.map((c) => c.number)).toEqual([1, 2]);
    expect(nextChangeOrderNumber(site())).toBe(1); // files without a log start at 1
  });
});

describe("voiding change orders", () => {
  const meta = (title: string) => ({ date: "2026-10-11", title, reason: "", requested_by: "" });
  const voidMeta = { date: "2026-10-12", reason: "Issued in error", voided_by: "PM" };
  // issue an order that applies ``edit`` to the current specs
  const issue = (s: Site, title: string, edit: (d: ReturnType<typeof specsOf>) => void, at: string) => {
    const draft = specsOf(s);
    edit(draft);
    return issueChangeOrder(s, draft, diffSpecs(s, draft, names), meta(title), new Date(at));
  };
  const pad = (s: Site) => s.zones[0].target_elevation_m ?? null;

  test("voiding the only order puts its specs back and keeps it in the log", () => {
    const one = issue(site(), "Raise pad", (d) => {
      d.zones[0].target_elevation_m = 101;
      d.tolerance_m = 0.1;
    }, "2026-10-11T09:00:00Z");
    const voided = voidChangeOrder(one, 1, voidMeta, names, new Date("2026-10-12T09:00:00Z"));

    expect(pad(voided)).toBeNull();
    expect(voided.tolerance_m).toBe(0.05);
    expect(voided.change_orders).toHaveLength(1);
    expect(voided.change_orders![0].voided).toMatchObject({
      reason: "Issued in error",
      voided_by: "PM",
      voided_at: "2026-10-12T09:00:00.000Z",
      kept: [],
    });
    expect(voided.change_orders![0].voided!.restored.map((c) => [c.before, c.after])).toEqual([
      ["±10 cm", "±5 cm"],
      ["Flat pad at 101.000 m", "Design surface"],
    ]);
    expect(canVoid(voided.change_orders![0])).toBe(false); // can't be voided twice
  });

  test("a spec changed again by a later order keeps the later value", () => {
    let s = issue(site(), "Pad to 101", (d) => (d.zones[0].target_elevation_m = 101), "2026-10-01T00:00:00Z");
    s = issue(s, "Pad to 102", (d) => {
      d.zones[0].target_elevation_m = 102;
    }, "2026-10-02T00:00:00Z");
    s = issue(s, "Tolerance", (d) => (d.tolerance_m = 0.02), "2026-10-03T00:00:00Z");

    const plan = planVoid(s, 1, names);
    const voided = voidChangeOrder(s, 1, voidMeta, names);

    expect(plan.restored).toEqual([]);
    expect(plan.kept).toEqual([{ field: "grade", zone_id: "w", zone_name: "West", by_number: 2 }]);
    expect(pad(voided)).toBe(102);
  });

  test("voiding a later order falls back to the earlier order still in effect", () => {
    let s = issue(site(), "Pad to 101", (d) => (d.zones[0].target_elevation_m = 101), "2026-10-01T00:00:00Z");
    s = issue(s, "Pad to 102", (d) => (d.zones[0].target_elevation_m = 102), "2026-10-02T00:00:00Z");
    expect(pad(voidChangeOrder(s, 2, voidMeta, names))).toBe(101);
  });

  test("voiding both orders, in either order, returns to the original spec", () => {
    let s = issue(site(), "Pad to 101", (d) => (d.zones[0].target_elevation_m = 101), "2026-10-01T00:00:00Z");
    s = issue(s, "Pad to 102", (d) => (d.zones[0].target_elevation_m = 102), "2026-10-02T00:00:00Z");

    const firstThenSecond = voidChangeOrder(voidChangeOrder(s, 1, voidMeta, names), 2, voidMeta, names);
    const secondThenFirst = voidChangeOrder(voidChangeOrder(s, 2, voidMeta, names), 1, voidMeta, names);

    expect(pad(firstThenSecond)).toBeNull();
    expect(pad(secondThenFirst)).toBeNull();
    expect(firstThenSecond.change_orders!.every((co) => co.voided)).toBe(true);
  });

  test("a deleted zone's specs are listed as kept, not restored", () => {
    const s = issue(site(), "Pad", (d) => (d.zones[0].finish = "2026-12-01"), "2026-10-01T00:00:00Z");
    const plan = planVoid({ ...s, zones: [] }, 1, names);
    expect(plan.kept).toEqual([{ field: "finish", zone_id: "w", zone_name: "West", by_number: null }]);
  });

  test("orders logged without stored values can't be voided", () => {
    const old = issue(site(), "Pad", (d) => (d.tolerance_m = 0.1), "2026-10-01T00:00:00Z");
    const legacy = { ...old.change_orders![0], changes: old.change_orders![0].changes.map(({ values: _v, ...c }) => c) };
    expect(canVoid(legacy)).toBe(false);
    expect(voidChangeOrder({ ...old, change_orders: [legacy] }, 1, voidMeta, names).change_orders![0].voided).toBeUndefined();
  });
});
