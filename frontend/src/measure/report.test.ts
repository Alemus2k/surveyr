import { afterEach, describe, expect, it } from "vitest";
import { setUnitSystem } from "../lib/units";
import type { Vec3 } from "./geometry";
import { measurementText, resultNotes, resultRows, sceneLabel, shortRunWarning } from "./report";
import type { Measurement } from "./state";

const E = 612_400, N = 4_270_150, FT = 0.3048;
const value = (rows: { label: string; value: string }[], label: string) => rows.find((r) => r.label === label)?.value;

afterEach(() => setUnitSystem("us"));

describe("measurement text", () => {
  // 100 ft west, falling 2 ft: a 2 % grade, 50:1
  const a: Vec3 = [E, N, 100 * FT];
  const b: Vec3 = [E - 100 * FT, N, 98 * FT];
  const dist: Measurement = { id: 1, kind: "distance", n: 1, points: [a, b] };

  it("distance in feet", () => {
    setUnitSystem("us");
    const rows = resultRows(dist);
    expect(value(rows, "Horizontal distance")).toBe("100.00 ft");
    expect(value(rows, "Height change")).toBe("−2.00 ft");
    expect(value(rows, "Slope distance")).toBe("100.02 ft");
    expect(value(rows, "Grade")).toBe("2.0 % falling (50:1)");
    expect(value(rows, "Direction")).toBe("S 90°00′ W");
    expect(sceneLabel(dist)).toBe("100.00 ft · 2.0 %");
    expect(resultNotes(dist)).toEqual([]);
  });

  it("switches to metres live", () => {
    setUnitSystem("metric");
    expect(value(resultRows(dist), "Horizontal distance")).toBe("30.48 m");
    expect(value(resultRows(dist), "Grade")).toBe("2.0 % falling (50:1)"); // unit-free
  });

  it("warns about grades over short runs", () => {
    setUnitSystem("us");
    expect(shortRunWarning(20)).toBeNull();
    const w = shortRunWarning(2 * FT);
    expect(w).toContain("under 10 ft");
    expect(w).toContain("±6.6 %"); // 4 cm over 2 ft
    const short: Measurement = { id: 2, kind: "distance", n: 2, points: [a, [E + 2 * FT, N, a[2]]] };
    expect(resultNotes(short)).toHaveLength(1);
    setUnitSystem("metric");
    expect(shortRunWarning(2)).toContain("under 3 m");
  });

  it("area rows and the clipboard text", () => {
    setUnitSystem("us");
    const sq: Vec3[] = [[E, N, 0], [E + 10 * FT, N, 0], [E + 10 * FT, N + 10 * FT, 0], [E, N + 10 * FT, 0]];
    const area: Measurement = {
      id: 3,
      kind: "area",
      n: 1,
      points: sq,
      surface: { planArea: 100 * FT * FT, surfaceArea: 100 * FT * FT, meanElevation: 200 * FT, minElevation: 199 * FT, maxElevation: 201 * FT, coverage: 1, cell: 0.5 },
    };
    const rows = resultRows(area);
    expect(value(rows, "Area (plan)")).toBe("100 sq ft");
    expect(value(rows, "Perimeter")).toBe("40.00 ft");
    expect(value(rows, "Average elevation")).toBe("200.00 ft");
    const text = measurementText(area);
    expect(text.split("\n")[0]).toBe("Area 1");
    expect(text).toContain("Surface area: 100 sq ft");
    expect(text).toContain("Spot 4: E ");
  });

  it("path legs in the clipboard text", () => {
    setUnitSystem("us");
    const path: Measurement = { id: 4, kind: "path", n: 1, points: [[E, N, 0], [E + 30 * FT, N, 0], [E + 30 * FT, N + 40 * FT, 0]] };
    const text = measurementText(path);
    expect(text).toContain("Length (horizontal): 70.00 ft");
    expect(text).toContain("Leg 2: 40.00 ft, level");
  });
});
