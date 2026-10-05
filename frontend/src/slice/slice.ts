import type { SceneBox } from "../viewer/backdrop";
import type { PreparedCloud } from "../viewer/prepare";

/** "ew": a section running east–west (band across northing). "ns": running north–south. */
export type SliceAxis = "ew" | "ns";

export interface SliceSpec {
  axis: SliceAxis;
  offset: number; // metres from the scan centre, across the section line
  thickness: number; // band width in metres
}

/** Points inside a slice band, in profile coordinates. */
export interface SliceSample {
  u: Float32Array; // distance along the section line (m, centred; east or north positive)
  z: Float32Array; // true elevation (m), unexaggerated
  index: Uint32Array; // source point index, for colouring
}

/** Any set of points to slice: scene positions (x east, y up, z = -north, centred on
 *  the view) plus each point's true elevation in metres. */
export interface SliceSource {
  positions: Float32Array;
  elevation: Float32Array;
}

/** How far the slice can move either side of centre. */
export function sliceHalfRange(cloud: { box: SceneBox }, axis: SliceAxis): number {
  return axis === "ew" ? cloud.box.halfZ : cloud.box.halfX;
}

export function selectSliceFrom(src: SliceSource, spec: SliceSpec): SliceSample {
  const half = spec.thickness / 2;
  const { positions, elevation } = src;
  const picked: number[] = [];
  for (let i = 0; i < elevation.length; i++) {
    const east = positions[i * 3];
    const north = -positions[i * 3 + 2];
    const across = spec.axis === "ew" ? north : east;
    if (Math.abs(across - spec.offset) <= half) picked.push(i);
  }
  const u = new Float32Array(picked.length);
  const z = new Float32Array(picked.length);
  picked.forEach((idx, k) => {
    u[k] = spec.axis === "ew" ? positions[idx * 3] : -positions[idx * 3 + 2];
    z[k] = elevation[idx];
  });
  return { u, z, index: Uint32Array.from(picked) };
}

export function selectSlice(cloud: PreparedCloud, spec: SliceSpec): SliceSample {
  return selectSliceFrom({ positions: cloud.positions, elevation: cloud.z }, spec);
}
