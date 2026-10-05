import * as THREE from "three";
import type { SliceSpec } from "../slice/slice";
import type { SceneBox } from "./backdrop";

/** Translucent box marking the slice band in 3D (highlight-coloured). */
export interface SliceOutline {
  group: THREE.Group;
  setAccent: (hex: string) => void;
  /** Show the band for ``spec`` within ``box``, or hide it when null. */
  place: (spec: SliceSpec | null, box: SceneBox, span: number) => void;
}

export function createSliceOutline(): SliceOutline {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const fill = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false });
  const edges = new THREE.LineBasicMaterial();
  group.add(new THREE.Mesh(geo, fill));
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edges));
  group.visible = false;

  return {
    group,
    setAccent(hex) {
      fill.color.set(hex);
      edges.color.set(hex);
    },
    place(spec, box, span) {
      group.visible = spec !== null;
      if (!spec) return;
      const tall = Math.max(box.height, span * 0.05) * 1.2;
      const margin = span * 0.04;
      if (spec.axis === "ew") {
        group.scale.set(box.halfX * 2 + margin, tall, spec.thickness);
        group.position.set(0, tall / 2, -spec.offset);
      } else {
        group.scale.set(spec.thickness, tall, box.halfZ * 2 + margin);
        group.position.set(spec.offset, tall / 2, 0);
      }
    },
  };
}
