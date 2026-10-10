import { describe, expect, test } from "vitest";
import { prepareCloud } from "../viewer/prepare";
import { profileLayout } from "./drawProfile";
import { elevationAt, selectSlice, selectSliceFrom, sliceHalfRange } from "./slice";

// 4 points on a 2 x 2 m patch; centre is (1, 1).
const cloud = prepareCloud(
  new Float32Array([
    0, 0, 0.0, // south-west
    2, 0, 0.2, // south-east
    0, 2, 0.4, // north-west
    2, 2, 0.6, // north-east
  ])
);

describe("selectSlice", () => {
  test("east-west slice keeps points in the northing band, plotted by easting", () => {
    const s = selectSlice(cloud, { axis: "ew", offset: -1, thickness: 0.2 });
    expect(Array.from(s.u)).toEqual([-1, 1]); // the two southern points
    expect(Array.from(s.z).map((v) => +v.toFixed(2))).toEqual([0, 0.2]);
  });

  test("north-south slice keeps points in the easting band, plotted by northing", () => {
    const s = selectSlice(cloud, { axis: "ns", offset: 1, thickness: 0.2 });
    expect(Array.from(s.u)).toEqual([-1, 1]); // the two eastern points, south first
    expect(Array.from(s.z).map((v) => +v.toFixed(2))).toEqual([0.2, 0.6]);
  });

  test("returns nothing when the band misses every point", () => {
    expect(selectSlice(cloud, { axis: "ew", offset: 0, thickness: 0.2 }).u.length).toBe(0);
  });
});

describe("sliceHalfRange", () => {
  test("is half the scan depth across the slice", () => {
    expect(sliceHalfRange(cloud, "ew")).toBe(1);
    expect(sliceHalfRange(cloud, "ns")).toBe(1);
  });
});

describe("selectSliceFrom", () => {
  test("slices any positioned point set, reporting the given true elevations", () => {
    // scene coords (x east, y up, z = -north) and separate true elevations
    const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 0, -2]);
    const elevation = new Float32Array([10, 11, 12]);

    const s = selectSliceFrom({ positions, elevation }, { axis: "ew", offset: 0, thickness: 0.5 });

    expect(Array.from(s.u)).toEqual([-1, 1]);
    expect(Array.from(s.z)).toEqual([10, 11]);
    expect(Array.from(s.index)).toEqual([0, 1]);
  });
});

describe("elevationAt", () => {
  const sample = {
    u: new Float32Array([-1, 0, 0.05, 0.1, 3]),
    z: new Float32Array([5, 10, 12, 11, 20]),
    index: new Uint32Array([0, 1, 2, 3, 4]),
  };

  test("is the median elevation of points near the cursor", () => {
    expect(elevationAt(sample, 0.05, 0.1)).toBeCloseTo(11); // 10, 12, 11
    expect(elevationAt(sample, 0.025, 0.04)).toBeCloseTo(11); // 10, 12 -> mean of the middle pair
  });

  test("is null where the band has no points", () => {
    expect(elevationAt(sample, 1.5, 0.2)).toBeNull();
  });
});

describe("profileLayout", () => {
  test("fromX inverts toX across the plot", () => {
    const l = profileLayout(600, 200, { span: 40, zMin: 100, zMax: 110 });
    expect(l.toX(-20)).toBeCloseTo(l.plotLeft);
    expect(l.toX(20)).toBeCloseTo(l.plotRight);
    for (const u of [-20, -3.7, 0, 12.5]) expect(l.fromX(l.toX(u))).toBeCloseTo(u);
  });
});
