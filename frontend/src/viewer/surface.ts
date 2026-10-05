import * as THREE from "three";
import { jetRamp, normalize } from "../color";
import type { ColorRange } from "./prepare";
import { surfaceIndices, surfacePositions, type ToScene } from "./surfaceMesh";

/** The slice of an analysis needed to draw a surface. */
export interface SurfaceGrid {
  x: number[];
  y: number[];
  z: number[][];
  mask: number[][];
}

export function buildSurfaceGeometry(grid: SurfaceGrid, toScene: ToScene): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(surfacePositions(grid.x, grid.y, grid.z, toScene), 3));
  geo.setIndex(new THREE.BufferAttribute(surfaceIndices(grid.mask), 1));
  geo.computeVertexNormals();
  return geo;
}

/** Per-vertex jet colours for the surface (same ramp and range as the points). */
export function setSurfaceColors(geo: THREE.BufferGeometry, grid: SurfaceGrid, range: ColorRange): void {
  const nx = grid.x.length;
  const rgb = new Float32Array(nx * grid.y.length * 3);
  for (let iy = 0; iy < grid.y.length; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [r, g, b] = jetRamp(normalize(grid.z[iy][ix], range.min, range.max));
      const o = (iy * nx + ix) * 3;
      rgb[o] = r / 255;
      rgb[o + 1] = g / 255;
      rgb[o + 2] = b / 255;
    }
  }
  geo.setAttribute("aColor", new THREE.BufferAttribute(rgb, 3));
}
