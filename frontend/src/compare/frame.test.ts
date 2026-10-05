import { describe, expect, test } from "vitest";
import {
  applyPlacement,
  combinedRange,
  compareFrame,
  layerExtent,
  localPositions,
  placement,
  transformFromPlacement,
  worldPoints,
} from "./frame";
import type { LayerTransform } from "./types";

const IDENTITY: LayerTransform = { tx: 0, ty: 0, tz: 0, yaw_deg: 0 };
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

// two 2x2 m patches; B sits 1 m east of A and 0.5 m higher
const A = new Float32Array([0, 0, 0, 2, 2, 0, 2, 0, 0, 0, 2, 0]);
const B = new Float32Array([1, 0, 0.5, 3, 2, 0.5, 3, 0, 0.5, 1, 2, 0.5]);

describe("compareFrame", () => {
  test("frames the union of all layers", () => {
    const f = compareFrame([layerExtent(A), layerExtent(B)]);
    expect(f.origin).toEqual({ x: 1.5, y: 1, z: 0 });
    expect(f.span).toBe(3);
  });
});

describe("placement", () => {
  test("untransformed layers keep their true relative positions", () => {
    const exA = layerExtent(A);
    const exB = layerExtent(B);
    const f = compareFrame([exA, exB]);
    const pa = placement(IDENTITY, exA, f);
    const pb = placement(IDENTITY, exB, f);
    expect(pb.position[0] - pa.position[0]).toBeCloseTo(1, 6); // 1 m east
    // B's points are 0.5 m up in local coordinates (shared vertical origin)
    const localB = localPositions(B, exB, f);
    expect(localB[1]).toBeCloseTo(0.5 * f.exaggeration, 6);
  });

  test("round-trips through the 3D handle's position and rotation", () => {
    const ex = layerExtent(B);
    const f = compareFrame([layerExtent(A), ex]);
    const t: LayerTransform = { tx: 0.25, ty: -1.5, tz: 0.1, yaw_deg: 30 };
    const p = placement(t, ex, f);
    const back = transformFromPlacement(p.position, p.yawRad, ex, f);
    close([back.tx, back.ty, back.tz, back.yaw_deg], [0.25, -1.5, 0.1, 30]);
  });

  test("positive yaw turns east toward north about the layer's own centre", () => {
    const ex = layerExtent(A);
    const f = compareFrame([ex]);
    const p = placement({ ...IDENTITY, yaw_deg: 90 }, ex, f);
    // a point 1 m east of the layer centre ends up 1 m north of it (north = -z)
    const world = applyPlacement([1, 0, 0], p);
    const centre = applyPlacement([0, 0, 0], p);
    close([world[0] - centre[0], world[2] - centre[2]], [0, -1]);
  });

  test("translation moves in survey axes: +tx east, +ty north", () => {
    const ex = layerExtent(A);
    const f = compareFrame([ex]);
    const base = placement(IDENTITY, ex, f).position;
    const moved = placement({ ...IDENTITY, tx: 2, ty: 3 }, ex, f).position;
    close([moved[0] - base[0], moved[2] - base[2]], [2, -3]);
  });
});

describe("combinedRange", () => {
  test("spans all layers' elevations", () => {
    const r = combinedRange([new Float32Array([0, 1, 2]), new Float32Array([5, 6])]);
    expect(r.min).toBeLessThan(2); // reaches into the first layer…
    expect(r.max).toBeGreaterThanOrEqual(5); // …and the second
  });
});

describe("worldPoints", () => {
  test("places a layer's points where the 3D view shows them, with true elevations", () => {
    const ex = layerExtent(B);
    const f = compareFrame([layerExtent(A), ex]);
    const t: LayerTransform = { tx: 0.5, ty: 0, tz: 0.25, yaw_deg: 0 };

    const w = worldPoints(B, ex, f, t);

    // first B point (1, 0, 0.5) moves 0.5 m east and 0.25 m up
    expect(w.positions[0]).toBeCloseTo(1 + 0.5 - f.origin.x, 6);
    expect(w.positions[2]).toBeCloseTo(-(0 - f.origin.y), 6);
    expect(w.elevation[0]).toBeCloseTo(0.75, 6);
  });
});

describe("layers with origins", () => {
  test("layers sent relative to different origins still line up in survey space", () => {
    // the same 1 m offset as A/B, but each layer arrives relative to its own origin
    const baseA = { x: 500_000, y: 6_000_000, z: 100 };
    const baseB = { x: 500_001, y: 6_000_000, z: 100 };
    const exA = layerExtent(A, baseA);
    const exB = layerExtent(A, baseB); // identical relative data, shifted origin
    const f = compareFrame([exA, exB]);
    const pa = placement({ tx: 0, ty: 0, tz: 0, yaw_deg: 0 }, exA, f);
    const pb = placement({ tx: 0, ty: 0, tz: 0, yaw_deg: 0 }, exB, f);
    expect(pb.position[0] - pa.position[0]).toBeCloseTo(1, 6);
    const w = worldPoints(A, exB, f, { tx: 0, ty: 0, tz: 0, yaw_deg: 0 }, baseB);
    expect(w.elevation[0]).toBeCloseTo(100, 6);
  });
});
