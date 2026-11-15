import { describe, expect, it } from "vitest";
import { prepareCloud } from "../viewer/prepare";
import {
  azimuthDeg,
  formatBearing,
  formatDms,
  formatGradePct,
  formatGradeRatio,
  groundSnap,
  measureDistance,
  measurePath,
  measureSurface,
  median,
  pointInPolygon,
  polygonArea,
  polygonPerimeter,
  sceneToSurvey,
  type Vec3,
} from "./geometry";

const E = 612_400, N = 4_270_150; // survey-sized coordinates, like the demo

describe("two-point distance", () => {
  it("3-4-5: 3 east, 4 north, level", () => {
    const r = measureDistance([E, N, 210], [E + 3, N + 4, 210]);
    expect(r.horizontal).toBeCloseTo(5, 12);
    expect(r.slope).toBeCloseTo(5, 12);
    expect(r.vertical).toBe(0);
    expect(r.gradePct).toBe(0);
  });

  it("3-4-5 in elevation: 4 m along, 3 m up", () => {
    const r = measureDistance([E, N, 100], [E + 4, N, 103]);
    expect(r.horizontal).toBeCloseTo(4, 12);
    expect(r.vertical).toBeCloseTo(3, 12);
    expect(r.slope).toBeCloseTo(5, 12);
    expect(r.gradePct).toBeCloseTo(75, 9);
  });

  it("1 % grade over 100 ft falls 1 ft", () => {
    const ft = 0.3048;
    const r = measureDistance([E, N, 50], [E - 100 * ft, N, 50 - 1 * ft]);
    expect(r.horizontal / ft).toBeCloseTo(100, 9);
    expect(r.vertical / ft).toBeCloseTo(-1, 9);
    expect(r.gradePct).toBeCloseTo(-1, 9);
    expect(formatGradePct(r.gradePct!)).toBe("1.0 %");
    expect(formatGradeRatio(r.gradePct!)).toBe("100:1");
  });

  it("a vertical pair has no grade or direction", () => {
    const r = measureDistance([E, N, 1], [E, N, 4]);
    expect(r.gradePct).toBeNull();
    expect(r.azimuth).toBeNull();
    expect(r.slope).toBe(3);
  });
});

describe("bearings", () => {
  it("quadrant bearings", () => {
    expect(formatBearing(azimuthDeg([0, 0], [1, 1])!)).toBe("N 45°00′ E");
    expect(formatBearing(azimuthDeg([0, 0], [1, -1])!)).toBe("S 45°00′ E");
    expect(formatBearing(azimuthDeg([0, 0], [-1, -1])!)).toBe("S 45°00′ W");
    expect(formatBearing(azimuthDeg([0, 0], [-1, 1])!)).toBe("N 45°00′ W");
    expect(formatBearing(0)).toBe("N 0°00′ E");
    expect(formatBearing(90)).toBe("N 90°00′ E");
    expect(formatBearing(45.2)).toBe("N 45°12′ E");
    expect(formatBearing(180 + 30.5)).toBe("S 30°30′ W");
    expect(formatBearing(360 - 10.25)).toBe("N 10°15′ W");
  });

  it("rounds minutes with carry and wraps at north", () => {
    expect(formatBearing(44.9999)).toBe("N 45°00′ E");
    expect(formatBearing(359.999)).toBe("N 0°00′ E");
    expect(formatDms(12.5)).toBe("12°30′");
    expect(formatDms(12.50347, true)).toBe("12°30′12″");
  });

  it("azimuth is clockwise from north", () => {
    expect(azimuthDeg([0, 0], [0, 5])).toBe(0);
    expect(azimuthDeg([0, 0], [5, 0])).toBe(90);
    expect(azimuthDeg([0, 0], [0, -5])).toBe(180);
    expect(azimuthDeg([0, 0], [-5, 0])).toBe(270);
  });
});

describe("grade text", () => {
  it("percent and run:rise", () => {
    expect(formatGradePct(3.2)).toBe("3.2 %");
    expect(formatGradePct(-0.45)).toBe("0.45 %");
    expect(formatGradeRatio(3.2)).toBe("31:1");
    expect(formatGradeRatio(100 / 3)).toBe("3:1");
    expect(formatGradeRatio(50)).toBe("2:1");
    expect(formatGradeRatio(-40)).toBe("2.5:1");
    expect(formatGradeRatio(200)).toBe("1:2");
    expect(formatGradeRatio(0)).toBeNull();
  });
});

describe("paths", () => {
  it("sums legs in plan and along the slope", () => {
    const pts: Vec3[] = [
      [E, N, 10],
      [E + 3, N + 4, 10], // 5 level
      [E + 3, N + 8, 13], // 4 along, 3 up → 5 slope
    ];
    const r = measurePath(pts);
    expect(r.legs).toHaveLength(2);
    expect(r.horizontal).toBeCloseTo(9, 12);
    expect(r.slope).toBeCloseTo(10, 12);
    expect(r.vertical).toBe(3);
    expect(r.climb).toBe(3);
    expect(r.descent).toBe(0);
  });
});

describe("polygons", () => {
  const square: Vec3[] = [
    [E, N, 0],
    [E + 10, N, 0],
    [E + 10, N + 10, 0],
    [E, N + 10, 0],
  ];

  it("a 10 × 10 square is 100 in area and 40 around, either winding", () => {
    expect(polygonArea(square)).toBeCloseTo(100, 9);
    expect(polygonArea([...square].reverse())).toBeCloseTo(100, 9);
    expect(polygonPerimeter(square)).toBeCloseTo(40, 9);
  });

  it("a 3-4-5 triangle is 6", () => {
    expect(polygonArea([[0, 0], [3, 0], [3, 4]])).toBe(6);
    expect(polygonPerimeter([[0, 0], [3, 0], [3, 4]])).toBe(12);
  });

  it("point in polygon", () => {
    expect(pointInPolygon(E + 5, N + 5, square)).toBe(true);
    expect(pointInPolygon(E + 11, N + 5, square)).toBe(false);
  });

  it("flat ground: surface = plan, mean = the level", () => {
    const r = measureSurface(square, () => 212.5, 0.5);
    expect(r.surfaceArea).toBeCloseTo(100, 9);
    expect(r.meanElevation).toBeCloseTo(212.5, 9);
    expect(r.coverage).toBe(1);
  });

  it("a 45° roof has √2 × the plan area, at any cell size and tilt direction", () => {
    for (const cell of [0.3, 1, 3.7]) {
      const east = measureSurface(square, (e) => e - E, cell);
      expect(east.surfaceArea).toBeCloseTo(100 * Math.SQRT2, 6);
      const diag = measureSurface(square, (e, n) => ((e - E) + (n - N)) / Math.SQRT2, cell);
      expect(diag.surfaceArea).toBeCloseTo(100 * Math.SQRT2, 6);
    }
    // mean elevation of the plane over the square is its centre's height
    expect(measureSurface(square, (e) => e - E, 0.5).meanElevation).toBeCloseTo(5, 6);
  });

  it("unscanned ground is left out and reported", () => {
    const r = measureSurface(square, (e) => (e < E + 5 ? 1 : null), 0.5);
    expect(r.coverage).toBeGreaterThan(0.4);
    expect(r.coverage).toBeLessThan(0.6);
    expect(r.surfaceArea).toBeCloseTo(100, 6);
    expect(measureSurface(square, () => null, 1).surfaceArea).toBeNull();
  });
});

describe("ground snap", () => {
  it("median ignores one wild point", () => {
    expect(median([1, 2, 100])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("a single noisy return doesn't move the ground", () => {
    const pts: Vec3[] = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) pts.push([E + i * 0.5, N + j * 0.5, 210]);
    pts.push([E + 0.01, N, 210.3]); // a 0.3 m spike right where the user clicks
    expect(groundSnap(pts, E, N, 9)).toBe(210);
    expect(groundSnap(pts, E + 50, N, 9, 2)).toBeNull();
  });
});

describe("scene → survey", () => {
  it("undoes centring and vertical exaggeration", () => {
    // a flat 100 × 100 m site with 1 m of relief gets exaggerated ×3
    const xyz: number[] = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) xyz.push(i * 10, j * 10, (i * 10) / 100);
    const base = { x: E, y: N, z: 200 };
    const cloud = prepareCloud(new Float32Array(xyz), base);
    expect(cloud.exaggeration).toBe(3);
    // the point at local (30, 70) is at elevation 200.3
    const k = 3 * 11 + 7;
    const p = cloud.positions;
    const s = sceneToSurvey(cloud, p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    expect(s[0]).toBeCloseTo(E + 30, 4);
    expect(s[1]).toBeCloseTo(N + 70, 4);
    expect(s[2]).toBeCloseTo(200.3, 4);
    // and a measured grade is the true 1 %, not the 3 % the eye sees
    const a = sceneToSurvey(cloud, p[0], p[1], p[2]);
    const last = 120;
    const b = sceneToSurvey(cloud, p[last * 3], p[last * 3 + 1], p[last * 3 + 2]);
    expect(measureDistance(a, [b[0], a[1], b[2]]).gradePct).toBeCloseTo(1, 3);
  });
});
