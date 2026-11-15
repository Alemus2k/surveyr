// Measurements on the Riverside demo (2 Nov 2026 flight) against the demo's
// exact answers. fixtures/riverside_spots.json holds the points the 3D view
// loads (service.sample_points_with_origin, ≈96k cleaned ground points) within
// 2.5 m of a few spots, plus the generator's noise-free ground elevation there
// (make_jobsite_demo.ground(x, y, k=7)). Coordinates are local metres from
// the demo's SW corner (E0, N0 in the file); z is true elevation.
import { describe, expect, it } from "vitest";
import data from "./fixtures/riverside_spots.json";
import { formatBearing, groundSnap, measureDistance, type Vec3 } from "./geometry";
import { SNAP_K } from "./groundIndex";

const SPACING = 0.51; // m, mean point spacing of that flight in the viewer (96,474 points over 180 × 140 m)
const REACH = 4 * SPACING;

type Spot = { e: number; n: number; truth_z: number; points: [number, number, number][] };
const spots = data.spots as unknown as Record<string, Spot>;

/** What a click at a spot gives: plan position as clicked, elevation snapped to the ground. */
function at(name: string): Vec3 {
  const s = spots[name];
  const x = s.e - data.e0, y = s.n - data.n0;
  const z = groundSnap(s.points, x, y, SNAP_K, REACH);
  if (z === null) throw new Error(`no ground at ${name}`);
  return [s.e, s.n, z];
}

describe("Riverside demo, 2 Nov 2026", () => {
  it("snapped elevations are within 3 cm of the true ground", () => {
    for (const [name, s] of Object.entries(spots)) {
      expect(Math.abs(at(name)[2] - s.truth_z), name).toBeLessThan(0.03);
    }
  });

  it("the access road falls 2 % westward (subgrade and base course)", () => {
    for (const [east, west] of [
      ["road_sub_east", "road_sub_west"],
      ["road_base_east", "road_base_west"],
    ]) {
      const r = measureDistance(at(east), at(west));
      const truth = ((spots[west].truth_z - spots[east].truth_z) / r.horizontal) * 100;
      expect(r.gradePct!).toBeLessThan(0); // falling toward the west
      expect(Math.abs(r.gradePct! - truth)).toBeLessThan(0.1);
      expect(Math.abs(r.gradePct! + 2)).toBeLessThan(0.15);
      expect(formatBearing(r.azimuth!)).toBe("S 90°00′ W");
    }
  });

  it("the building pad is flat", () => {
    const r = measureDistance(at("pad_a"), at("pad_b"));
    expect(Math.abs(r.vertical)).toBeLessThan(0.02);
    expect(Math.abs(r.gradePct!)).toBeLessThan(0.05);
    expect(Math.abs(at("pad_a")[2] - 214.55)).toBeLessThan(0.02); // PAD_Z
  });
});
