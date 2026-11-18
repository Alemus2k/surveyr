import { describe, expect, it } from "vitest";
import type { Vec3 } from "./geometry";
import { EMPTY_MEASURE, measureReducer, type MeasureAction, type MeasureState } from "./state";

const run = (actions: MeasureAction[], from: MeasureState = EMPTY_MEASURE) => actions.reduce(measureReducer, from);
const p = (e: number): Vec3 => [e, 0, 0];

describe("measure state", () => {
  it("a point finishes on one click, a distance on two", () => {
    let s = run([{ type: "mode", mode: "point" }, { type: "add", point: p(1) }]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "point", n: 1 });
    expect(s.mode).toBe("point"); // stays on for the next one
    s = run([{ type: "mode", mode: "distance" }, { type: "add", point: p(1) }], s);
    expect(s.items).toHaveLength(1);
    expect(s.draft).toHaveLength(1);
    s = run([{ type: "add", point: p(2) }], s);
    expect(s.items[1]).toMatchObject({ kind: "distance", n: 1, points: [p(1), p(2)] });
    expect(s.selected).toBe(s.items[1].id);
  });

  it("paths and areas finish on request, with enough points", () => {
    let s = run([{ type: "mode", mode: "area" }, { type: "add", point: p(1) }, { type: "add", point: p(2) }, { type: "finish" }]);
    expect(s.items).toHaveLength(0); // two points are not an area
    s = run([{ type: "add", point: p(3) }, { type: "finish" }], s);
    expect(s.items[0].points).toHaveLength(3);
    expect(s.draft).toHaveLength(0);
  });

  it("Backspace drops the last point; Esc drops the draft, then leaves the tool", () => {
    let s = run([{ type: "mode", mode: "path" }, { type: "add", point: p(1) }, { type: "add", point: p(2) }, { type: "undo" }]);
    expect(s.draft).toEqual([p(1)]);
    s = run([{ type: "cancel" }], s);
    expect(s.draft).toEqual([]);
    expect(s.mode).toBe("path");
    s = run([{ type: "cancel" }], s);
    expect(s.mode).toBeNull();
  });

  it("numbers each kind separately and deletes one at a time", () => {
    const s = run([
      { type: "mode", mode: "point" },
      { type: "add", point: p(1) },
      { type: "add", point: p(2) },
      { type: "mode", mode: "distance" },
      { type: "add", point: p(1) },
      { type: "add", point: p(3) },
      { type: "remove", id: 1 },
    ]);
    expect(s.items.map((m) => `${m.kind}${m.n}`)).toEqual(["point2", "distance1"]);
    expect(run([{ type: "clear" }], s).items).toEqual([]);
  });

  it("picking the active tool again turns it off", () => {
    const s = run([{ type: "mode", mode: "area" }, { type: "mode", mode: "area" }]);
    expect(s.mode).toBeNull();
  });
});
