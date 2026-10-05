// 3D scene for comparisons: one THREE.Group per layer (points and/or surface),
// placed by its LayerTransform, plus a move/rotate gizmo for the selected layer.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { niceStep } from "../viewer/backdrop";
import {
  createPointsMaterial,
  createSurfaceMaterials,
  randomAttribute,
  setPointsSolid,
  setSurfaceSolid,
  surfaceMeshes,
  type SurfaceMaterials,
} from "../viewer/materials";
import type { ColorRange } from "../viewer/prepare";
import type { SliceSpec } from "../slice/slice";
import { createSliceOutline } from "../viewer/sliceOutline";
import { createStage, type ViewPreset } from "../viewer/stage";
import { buildSurfaceGeometry, setSurfaceColors, type SurfaceGrid } from "../viewer/surface";
import { layerToLocal, localPositions, placement, transformFromPlacement, type CompareFrame } from "./frame";
import type { LayerSettings, LayerTransform } from "./types";
import type { LayerData } from "./useComposition";

export type GizmoMode = "translate" | "rotate";

const POINT_SIZE_FACTOR = 1.6;
const SURFACE_GRID_DIVISIONS = 20;

export interface CompareLayerInput {
  settings: LayerSettings;
  data: LayerData;
  colors: Float32Array; // elevation colours for the points (shared range across layers)
}

export interface CompareScene {
  sync: (layers: CompareLayerInput[], range: ColorRange) => void;
  select: (projectId: string | null, mode: GizmoMode) => void;
  setPointScale: (scale: number) => void;
  setSlice: (spec: SliceSpec | null) => void;
  setAccent: (hex: string) => void;
  setGridVisible: (visible: boolean) => void;
  goTo: (preset: ViewPreset) => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

interface LayerObjects {
  group: THREE.Group;
  pointsGeo: THREE.BufferGeometry;
  pointsMat: THREE.ShaderMaterial;
  points: THREE.Points;
  colors: Float32Array;
  surface: { group: THREE.Group; geo: THREE.BufferGeometry; grid: SurfaceGrid; range: ColorRange } | null;
  surfaceMats: SurfaceMaterials;
  data: LayerData;
}

export function createCompareScene(
  host: HTMLElement,
  frame: CompareFrame,
  onHeading: (radians: number) => void,
  onTransform: (projectId: string, t: LayerTransform) => void
): CompareScene {
  const stage = createStage(host, { box: frame.box, span: frame.span }, onHeading);
  const layers = new Map<string, LayerObjects>();
  const gridStep = niceStep(frame.span / SURFACE_GRID_DIVISIONS);
  let pointScale = 1;
  let selected: string | null = null;

  const gizmo = new TransformControls(stage.camera, stage.renderer.domElement);
  gizmo.setSize(0.8);
  gizmo.addEventListener("dragging-changed", (e) => {
    stage.controls.enabled = !(e as unknown as { value: boolean }).value;
  });
  gizmo.addEventListener("objectChange", () => {
    if (!selected) return;
    const obj = layers.get(selected);
    if (!obj) return;
    const p = obj.group.position;
    onTransform(selected, transformFromPlacement([p.x, p.y, p.z], obj.group.rotation.y, obj.data.extent, frame));
  });
  stage.scene.add(gizmo);
  const outline = createSliceOutline();
  stage.scene.add(outline.group);

  // Translucent layers must blend far → near: rank layer groups by camera distance.
  stage.onFrame(() => {
    const cam = stage.camera.position;
    const ranked = [...layers.values()].sort(
      (a, b) => b.group.position.distanceToSquared(cam) - a.group.position.distanceToSquared(cam)
    );
    ranked.forEach((obj, i) => (obj.group.renderOrder = i));
  });

  const baseSize = (count: number) => (frame.span / Math.sqrt(Math.max(count, 1))) * POINT_SIZE_FACTOR;

  function create(id: string, input: CompareLayerInput, index: number): LayerObjects {
    const { data } = input;
    const count = data.xyz.length / 3;
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute("position", new THREE.BufferAttribute(localPositions(data.xyz, data.extent, frame, data.base), 3));
    pointsGeo.setAttribute("aColor", new THREE.BufferAttribute(input.colors, 3));
    pointsGeo.setAttribute("aRand", randomAttribute(count, index + 1));
    const pointsMat = createPointsMaterial({ size: baseSize(count) * pointScale });
    stage.trackPoints(pointsMat);
    const points = new THREE.Points(pointsGeo, pointsMat);
    const group = new THREE.Group();
    group.add(points);
    stage.scene.add(group);
    const obj: LayerObjects = {
      group,
      pointsGeo,
      pointsMat,
      points,
      colors: input.colors,
      surface: null,
      surfaceMats: createSurfaceMaterials({ opacity: 1, gridStep }),
      data,
    };
    layers.set(id, obj);
    return obj;
  }

  function remove(id: string) {
    const obj = layers.get(id);
    if (!obj) return;
    if (selected === id) gizmo.detach();
    stage.untrackPoints(obj.pointsMat);
    stage.scene.remove(obj.group);
    obj.pointsGeo.dispose();
    obj.pointsMat.dispose();
    obj.surface?.geo.dispose();
    obj.surfaceMats.prepass.dispose();
    obj.surfaceMats.shade.dispose();
    layers.delete(id);
  }

  function applySettings(obj: LayerObjects, s: LayerSettings, range: ColorRange) {
    const p = placement(s.transform, obj.data.extent, frame);
    obj.group.position.set(...p.position);
    obj.group.rotation.set(0, p.yawRad, 0);
    obj.group.visible = s.visible;

    const solid = s.color_mode === "layer" ? s.color : null;
    setPointsSolid(obj.pointsMat, solid);
    obj.pointsMat.uniforms.uOpacity.value = s.opacity;

    const wantSurface = s.render === "surface" && obj.data.surface !== null;
    if (wantSurface && obj.data.surface && (!obj.surface || obj.surface.grid !== obj.data.surface)) {
      if (obj.surface) {
        obj.group.remove(obj.surface.group);
        obj.surface.geo.dispose();
      }
      const geo = buildSurfaceGeometry(obj.data.surface, layerToLocal(obj.data.extent, frame));
      setSurfaceColors(geo, obj.data.surface, range);
      const sgroup = surfaceMeshes(geo, obj.surfaceMats);
      obj.group.add(sgroup);
      obj.surface = { group: sgroup, geo, grid: obj.data.surface, range };
    }
    if (obj.surface && (obj.surface.range.min !== range.min || obj.surface.range.max !== range.max)) {
      setSurfaceColors(obj.surface.geo, obj.surface.grid, range);
      obj.surface.range = range;
    }
    setSurfaceSolid(obj.surfaceMats, solid);
    obj.surfaceMats.shade.uniforms.uOpacity.value = s.opacity;
    obj.points.visible = !wantSurface; // still points while a surface is loading
    if (obj.surface) obj.surface.group.visible = wantSurface;
  }

  return {
    sync(inputs, range) {
      const wanted = new Set(inputs.map((i) => i.settings.project_id));
      for (const id of [...layers.keys()]) if (!wanted.has(id)) remove(id);
      inputs.forEach((input, index) => {
        const id = input.settings.project_id;
        const obj = layers.get(id) ?? create(id, input, index);
        if (obj.colors !== input.colors) {
          obj.pointsGeo.setAttribute("aColor", new THREE.BufferAttribute(input.colors, 3));
          obj.colors = input.colors;
        }
        obj.data = input.data;
        applySettings(obj, input.settings, range);
      });
      // a locked or hidden layer can't keep the gizmo
      const sel = inputs.find((i) => i.settings.project_id === selected)?.settings;
      if (sel && (sel.locked || !sel.visible)) gizmo.detach();
    },
    select(projectId, mode) {
      selected = projectId;
      const obj = projectId ? layers.get(projectId) : undefined;
      if (!obj) {
        gizmo.detach();
        return;
      }
      gizmo.setMode(mode);
      gizmo.showX = mode === "translate";
      gizmo.showZ = mode === "translate";
      gizmo.showY = true; // translate: vertical shift; rotate: yaw only
      gizmo.attach(obj.group);
    },
    setPointScale(scale) {
      pointScale = scale;
      for (const obj of layers.values()) {
        obj.pointsMat.uniforms.uSize.value = baseSize(obj.data.xyz.length / 3) * scale;
      }
    },
    setSlice(spec) {
      outline.place(spec, frame.box, frame.span);
    },
    setAccent: outline.setAccent,
    setGridVisible: stage.setGridVisible,
    goTo: stage.goTo,
    resize: stage.resize,
    dispose() {
      gizmo.detach();
      gizmo.dispose();
      for (const id of [...layers.keys()]) remove(id);
      stage.dispose();
    },
  };
}
