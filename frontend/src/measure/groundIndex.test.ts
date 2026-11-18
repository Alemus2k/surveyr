import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { prepareCloud } from "../viewer/prepare";
import { buildGroundIndex } from "./groundIndex";

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n random points over w × h metres on a plane rising `grade` eastward, with Gaussian-ish noise. */
function plane(n: number, w: number, h: number, grade: number, noise: number, seed = 1) {
  const r = rng(seed);
  const xyz = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h;
    const g = (r() + r() + r() - 1.5) * 2 * noise; // ≈ N(0, noise)
    xyz.set([x, y, 10 + grade * x + g], i * 3);
  }
  return xyz;
}

describe("ground index", () => {
  it("nearest matches brute force", () => {
    const cloud = prepareCloud(plane(5000, 50, 40, 0, 0));
    const idx = buildGroundIndex(cloud);
    const r = rng(7);
    for (let q = 0; q < 50; q++) {
      const sx = (r() - 0.5) * 50, sz = (r() - 0.5) * 40;
      const got = idx.nearest(sx, sz, 9, Infinity);
      const all = Array.from({ length: cloud.count }, (_, i) => i).sort(
        (a, b) =>
          Math.hypot(cloud.positions[a * 3] - sx, cloud.positions[a * 3 + 2] - sz) -
          Math.hypot(cloud.positions[b * 3] - sx, cloud.positions[b * 3 + 2] - sz)
      );
      expect(got).toEqual(all.slice(0, 9));
    }
  });

  it("ground snap beats single-point noise", () => {
    const cloud = prepareCloud(plane(20000, 50, 40, 0, 0.02, 3)); // 2 cm noise, flat at 10 m
    const idx = buildGroundIndex(cloud);
    const r = rng(11);
    let worst = 0;
    for (let q = 0; q < 200; q++) {
      const z = idx.groundAt((r() - 0.5) * 40, (r() - 0.5) * 30)!;
      worst = Math.max(worst, Math.abs(z - 10));
    }
    expect(worst).toBeLessThan(0.03); // a single point would often be ±4 cm off
    expect(idx.groundAt(500, 500)).toBeNull(); // off the scan
  });

  it("picks the surface the ray hits first, matching brute force", () => {
    const cloud = prepareCloud(plane(20000, 60, 60, 0.05, 0.01, 5));
    const idx = buildGroundIndex(cloud);
    const cam = new THREE.PerspectiveCamera(50, 1.5, 0.1, 1000);
    cam.position.set(-40, 30, 50);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const angle = (6 * 2 * Math.tan((25 * Math.PI) / 180)) / 800; // 6 px on an 800 px viewport
    const r = rng(9);
    let hits = 0;
    for (let q = 0; q < 40; q++) {
      ray.setFromCamera(new THREE.Vector2(r() - 0.5, r() - 0.5), cam);
      const o = ray.ray.origin, d = ray.ray.direction;
      const hit = idx.pick({ origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }, { angle, minRadius: 0 });
      // brute force: nearest-along-ray point inside the cone
      let best: number | null = null, bestT = Infinity;
      const p = new THREE.Vector3();
      for (let i = 0; i < cloud.count; i++) {
        p.fromArray(cloud.positions, i * 3).sub(o);
        const t = p.dot(d);
        if (t <= 0) continue;
        const perp = Math.sqrt(Math.max(p.lengthSq() - t * t, 0));
        if (perp <= angle * t && t < bestT) [best, bestT] = [i, t];
      }
      expect(hit?.index ?? null).toBe(best);
      if (best !== null) hits++;
    }
    expect(hits).toBeGreaterThan(20);
  });

  it("hover pick + snap stays under a frame on 200k points", () => {
    const cloud = prepareCloud(plane(200_000, 180, 140, 0.02, 0.02, 2));
    const t0 = performance.now();
    const idx = buildGroundIndex(cloud);
    const build = performance.now() - t0;
    const cam = new THREE.PerspectiveCamera(50, 1.6, 0.2, 4000);
    cam.position.set(-190, 135, 216); // the viewer's default perspective for a 180 m site
    cam.lookAt(0, 2, 0);
    cam.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const angle = (6 * 2 * Math.tan((25 * Math.PI) / 180)) / 800;
    const r = rng(4);
    const n = 300;
    let worst = 0;
    const t1 = performance.now();
    for (let q = 0; q < n; q++) {
      const s = performance.now();
      ray.setFromCamera(new THREE.Vector2((r() - 0.5) * 1.6, (r() - 0.5) * 1.6), cam);
      const o = ray.ray.origin, d = ray.ray.direction;
      const hit = idx.pick({ origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }, { angle, minRadius: idx.spacing / 2 });
      if (hit) idx.groundAt(cloud.positions[hit.index * 3], cloud.positions[hit.index * 3 + 2]);
      worst = Math.max(worst, performance.now() - s);
    }
    const mean = (performance.now() - t1) / n;
    console.info(`index build ${build.toFixed(1)} ms; pick+snap mean ${mean.toFixed(3)} ms, worst ${worst.toFixed(2)} ms`);
    expect(build).toBeLessThan(200);
    expect(mean).toBeLessThan(4);
  });
});
