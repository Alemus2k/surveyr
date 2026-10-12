import { describe, expect, test } from "vitest";
import { formatLength } from "../lib/format";
import { axisLabelAnchors, axisMeasurements } from "./backdrop";
import { prepareCloud } from "./prepare";

// a 200 m (east) x 140 m (north) site, ground from 98 m to 103.5 m above datum
const XYZ = new Float32Array([0, 0, 98, 200, 0, 100, 0, 140, 101, 200, 140, 103.5]);

describe("axis measurements", () => {
  test("label each side's true length and the highest point", () => {
    const cloud = prepareCloud(XYZ);
    expect(axisMeasurements(cloud.box, cloud.zMax, formatLength)).toEqual({
      east: "200.00 m",
      north: "140.00 m",
      up: "103.50 m",
    });
  });

  test("the highest point ignores vertical exaggeration", () => {
    const cloud = prepareCloud(XYZ);
    expect(cloud.exaggeration).toBeGreaterThan(1); // flat site: stretched for display
    expect(axisMeasurements(cloud.box, cloud.zMax, formatLength).up).toBe("103.50 m");
  });

  test("anchors sit on the free end of each floor axis and the top of the up axis", () => {
    const box = { halfX: 100, halfZ: 70, height: 20 };
    const a = axisLabelAnchors(box, 20);
    expect(a.east.toArray()).toEqual([-100, 0, -70]); // axes meet at (+x, -z)
    expect(a.north.toArray()).toEqual([100, 0, 70]);
    expect(a.up.x).toBe(100);
    expect(a.up.z).toBe(-70);
    expect(a.up.y).toBeGreaterThan(box.height); // above the scan, at the axis tip
  });
});
