import { describe, expect, test } from "vitest";
import { cloudToScene, colorize, elevationHistogram, prepareCloud } from "./prepare";

// Three points: (x, y, z) in survey metres, Z up.
const XYZ = new Float32Array([0, 0, 0, 4, 2, 1, 2, 1, 0.5]);

describe("prepareCloud", () => {
  test("centres points and maps survey Z-up to scene Y-up with north = -Z", () => {
    const c = prepareCloud(XYZ);
    // first point: x 0 -> -2 (centre 2), height 0, y 0 -> north -1 -> scene z +1
    expect(Array.from(c.positions.slice(0, 3))).toEqual([-2, 0, 1]);
    expect(c.box.halfX).toBe(2);
    expect(c.box.halfZ).toBe(1);
  });

  test("keeps raw elevations for colouring and slicing", () => {
    const c = prepareCloud(XYZ);
    expect(Array.from(c.z)).toEqual([0, 1, 0.5]);
    expect(c.zMin).toBe(0);
    expect(c.zMax).toBe(1);
  });

  test("does not exaggerate scans whose relief is already visible", () => {
    expect(prepareCloud(XYZ).exaggeration).toBe(1);
  });

  test("exaggerates very flat sites, capped at 3x", () => {
    const flat = new Float32Array([0, 0, 0, 200, 200, 0.5]);
    expect(prepareCloud(flat).exaggeration).toBe(3);
  });
});

describe("prepareCloud with an origin", () => {
  test("keeps survey-grid coordinates exact by adding the origin back in double precision", () => {
    const base = { x: 500_000, y: 6_000_000, z: 120 };
    const c = prepareCloud(XYZ, base);
    expect(c.origin.y).toBe(6_000_001); // centre of 0..2 m + 6,000,000 — no float32 rounding
    expect(Array.from(c.z)).toEqual([120, 121, 120.5]); // true elevations
    expect(Array.from(c.positions.slice(0, 3))).toEqual([-2, 0, 1]); // scene stays local
  });
});

describe("cloudToScene", () => {
  test("puts each survey point exactly where the cloud's own points go", () => {
    const c = prepareCloud(XYZ);
    const toScene = cloudToScene(c);
    expect(toScene(4, 2, 1)).toEqual(Array.from(c.positions.slice(3, 6)));
  });
});

describe("colorize", () => {
  test("maps the range ends to the blue and red ends of the ramp", () => {
    const rgb = colorize(new Float32Array([0, 1]), { min: 0, max: 1 });
    expect(rgb[2]).toBeGreaterThan(rgb[0]); // first point: blue dominant
    expect(rgb[3]).toBeGreaterThan(rgb[5]); // second point: red dominant
  });
});

describe("elevationHistogram", () => {
  test("bins elevations between min and max", () => {
    const counts = elevationHistogram(new Float32Array([0, 0.1, 0.9, 1]), 2, 0, 1);
    expect(counts).toEqual([2, 2]);
  });
});
