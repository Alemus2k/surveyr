import * as THREE from "three";
import type { SliceSpec } from "../slice/slice";
import { niceStep } from "./backdrop";
import { createPointsMaterial, createSurfaceMaterials, randomAttribute, surfaceMeshes } from "./materials";
import { cloudToScene, type ColorRange, type PreparedCloud } from "./prepare";
import { createStage, type ViewPreset } from "./stage";
import { createSliceOutline } from "./sliceOutline";
import { buildSurfaceGeometry, setSurfaceColors, type SurfaceGrid } from "./surface";

export type { ViewPreset } from "./stage";
export type RenderMode = "points" | "surface";

const POINT_SIZE_FACTOR = 1.6; // dot diameter relative to mean point spacing
const SURFACE_GRID_DIVISIONS = 20; // surface grid lines across the long side

/** Everything one mounted single-project viewer owns; mutated by prop changes. */
export interface ViewerScene {
  setColors: (rgb: Float32Array) => void;
  setPointScale: (scale: number) => void;
  setGridVisible: (visible: boolean) => void;
  setSlice: (slice: SliceSpec | null) => void;
  setAccent: (hex: string) => void;
  setRenderMode: (mode: RenderMode) => void;
  /** Provide the elevation grid; the surface is built once and recoloured on demand. */
  setSurface: (grid: SurfaceGrid | null, range: ColorRange) => void;
  setSurfaceOpacity: (opacity: number) => void;
  goTo: (preset: ViewPreset) => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

/** Grid spacing drawn on the surface, in world units (plan view). */
export function surfaceGridStep(cloud: PreparedCloud): number {
  return niceStep(cloud.span / SURFACE_GRID_DIVISIONS);
}

/**
 * Build the scene for a prepared cloud inside ``host``.
 * ``onHeading`` receives the camera azimuth (radians, 0 = looking north) each frame.
 */
export function createViewerScene(
  host: HTMLElement,
  cloud: PreparedCloud,
  colors: Float32Array,
  onHeading: (radians: number) => void
): ViewerScene {
  const stage = createStage(host, { box: cloud.box, span: cloud.span }, onHeading);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aRand", randomAttribute(cloud.count));
  const baseSize = (cloud.span / Math.sqrt(Math.max(cloud.count, 1))) * POINT_SIZE_FACTOR;
  const mat = createPointsMaterial({ size: baseSize });
  stage.trackPoints(mat);
  const points = new THREE.Points(geo, mat);

  const outline = createSliceOutline();
  stage.scene.add(points, outline.group);

  const surfaceMats = createSurfaceMaterials({ opacity: 0.85, gridStep: surfaceGridStep(cloud) });
  let surface: { group: THREE.Group; geo: THREE.BufferGeometry; grid: SurfaceGrid } | null = null;
  let mode: RenderMode = "points";
  const applyMode = () => {
    points.visible = mode === "points" || !surface;
    if (surface) surface.group.visible = mode === "surface";
  };

  return {
    setColors(rgb) {
      geo.setAttribute("aColor", new THREE.BufferAttribute(rgb, 3));
    },
    setPointScale(scale) {
      mat.uniforms.uSize.value = baseSize * scale;
    },
    setGridVisible: stage.setGridVisible,
    setSlice(spec) {
      outline.place(spec, cloud.box, cloud.span);
    },
    setAccent: outline.setAccent,
    setRenderMode(next) {
      mode = next;
      applyMode();
    },
    setSurface(grid, range) {
      if (!grid) return;
      if (!surface || surface.grid !== grid) {
        if (surface) {
          stage.scene.remove(surface.group);
          surface.geo.dispose();
        }
        const sgeo = buildSurfaceGeometry(grid, cloudToScene(cloud));
        const group = surfaceMeshes(sgeo, surfaceMats);
        stage.scene.add(group);
        surface = { group, geo: sgeo, grid };
      }
      setSurfaceColors(surface.geo, grid, range);
      applyMode();
    },
    setSurfaceOpacity(opacity) {
      surfaceMats.shade.uniforms.uOpacity.value = opacity;
    },
    goTo: stage.goTo,
    resize: stage.resize,
    dispose: stage.dispose,
  };
}
