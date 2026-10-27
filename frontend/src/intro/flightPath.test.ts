import { describe, expect, test } from "vitest";
import { DOCK_POS, dronePosition, EXIT, scanFront } from "./flightPath";
import { groundHeight, sampleSite, SITE, surfaceHeight, STRUCTURES } from "./jobsite";
import { INTRO_END, progress, SKIP_TO, T } from "./timeline";

describe("timeline", () => {
  test("phases run in story order and finish by the end", () => {
    expect(T.eyeOpen[1]).toBeLessThanOrEqual(T.launch[0]); // eye is open before the drone launches
    expect(T.launch[1]).toBeLessThanOrEqual(T.pullAway[1]);
    expect(T.pullAway[0]).toBeLessThan(T.scan[0]); // first person into the start of the flyover
    expect(T.pullAway[1]).toBeLessThan(T.scan[1]); // then the wide shot watches the rest of the sweep
    expect(T.scan[1]).toBeLessThanOrEqual(T.gather[0]); // the whole site is scanned before the points lift off
    expect(T.worldOut[1]).toBeLessThanOrEqual(T.gather[1]);
    expect(T.gather[1]).toBeLessThanOrEqual(T.wordIn[1]);
    expect(T.wordIn[1]).toBeLessThan(T.dock[0]);
    for (const [start, end] of Object.values(T)) {
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(INTRO_END);
    }
  });

  test("skipping lands after the wordmark is formed", () => {
    expect(SKIP_TO).toBeGreaterThanOrEqual(T.wordIn[1]);
  });

  test("progress is clamped to 0..1", () => {
    expect(progress(-1, [0, 2])).toBe(0);
    expect(progress(1, [0, 2])).toBe(0.5);
    expect(progress(5, [0, 2])).toBe(1);
  });
});

describe("flight path", () => {
  test("the drone sits in its dock until launch, then climbs", () => {
    const rest = dronePosition(0);
    expect(rest.distanceTo(dronePosition(T.launch[0]))).toBeCloseTo(0);
    expect(Math.abs(rest.x - DOCK_POS.x)).toBeLessThan(0.01);
    expect(dronePosition(T.launch[1] - 0.01).y - rest.y).toBeGreaterThan(40);
  });

  test("the path is continuous where the launch hands over to the flight keys", () => {
    const before = dronePosition(T.launch[1] - 1e-4);
    const after = dronePosition(T.launch[1] + 1e-4);
    expect(before.distanceTo(after)).toBeLessThan(0.1);
  });

  test("the sweep crosses the whole site, left to right", () => {
    expect(dronePosition(T.scan[0]).x).toBeCloseTo(-SITE.halfX, 0);
    expect(dronePosition(T.scan[1]).x).toBeCloseTo(SITE.halfX, 0);
    let last = -Infinity;
    for (let t = T.scan[0]; t <= T.scan[1]; t += 0.1) {
      const x = dronePosition(t).x;
      expect(x).toBeGreaterThan(last);
      last = x;
    }
  });

  test("the scan front reveals nothing before the sweep and everything after", () => {
    expect(scanFront(T.scan[0] - 0.1, 0)).toBe(-Infinity);
    expect(scanFront(T.scan[1] + 0.1, 0)).toBe(Infinity);
    expect(scanFront((T.scan[0] + T.scan[1]) / 2, 12)).toBe(12);
  });

  test("after the sweep the drone climbs away out of shot", () => {
    expect(dronePosition(T.exit[1]).distanceTo(EXIT)).toBeCloseTo(0);
    expect(dronePosition(T.exit[1]).y).toBeGreaterThan(dronePosition(T.scan[1]).y + 50);
  });
});

describe("job site", () => {
  test("structures raise the scanned surface above the ground", () => {
    const s = STRUCTURES[0];
    expect(surfaceHeight(s.x, s.z) - groundHeight(s.x, s.z)).toBeCloseTo(s.h, 1);
  });

  test("the scan sample stays inside the fence and is the same every launch", () => {
    const a = sampleSite(4);
    const b = sampleSite(4);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i += 3) {
      expect(Math.abs(a[i])).toBeLessThanOrEqual(SITE.halfX);
      expect(Math.abs(a[i + 2])).toBeLessThanOrEqual(SITE.halfZ);
    }
  });
});
