// Geometry for the smooth-surface render mode, built from the analysis grid.
// Only triangles whose three corners were actually scanned are kept, so the
// surface follows the scan's real outline instead of filling its bounding box.

export type ToScene = (x: number, y: number, z: number) => [number, number, number];

/** Vertex positions for every grid node, row-major (row = y index, col = x index). */
export function surfacePositions(xs: number[], ys: number[], z: number[][], toScene: ToScene): Float32Array {
  const nx = xs.length;
  const out = new Float32Array(xs.length * ys.length * 3);
  for (let iy = 0; iy < ys.length; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [sx, sy, sz] = toScene(xs[ix], ys[iy], z[iy][ix]);
      const o = (iy * nx + ix) * 3;
      out[o] = sx;
      out[o + 1] = sy;
      out[o + 2] = sz;
    }
  }
  return out;
}

/** Triangle indices over scanned nodes; each grid quad splits into two triangles. */
export function surfaceIndices(mask: number[][]): Uint32Array {
  const ny = mask.length;
  const nx = mask[0]?.length ?? 0;
  const on = (ix: number, iy: number) => mask[iy][ix] > 0;
  const idx: number[] = [];
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iy * nx + ix; // (ix, iy)
      const b = a + 1; // (ix+1, iy)
      const c = a + nx; // (ix, iy+1)
      const d = c + 1; // (ix+1, iy+1)
      if (on(ix, iy) && on(ix + 1, iy) && on(ix, iy + 1)) idx.push(a, b, c);
      if (on(ix + 1, iy) && on(ix + 1, iy + 1) && on(ix, iy + 1)) idx.push(b, d, c);
    }
  }
  return Uint32Array.from(idx);
}
