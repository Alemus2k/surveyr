// Mirrors backend/app/compare.py (the saved .compare.json format).

export interface LayerTransform {
  tx: number; // metres east
  ty: number; // metres north
  tz: number; // metres up
  yaw_deg: number; // about the layer's own centre; positive turns east toward north
}

export type LayerRender = "points" | "surface";
export type LayerColorMode = "layer" | "elevation";

export interface LayerSettings {
  project_id: string;
  color: string;
  opacity: number;
  visible: boolean;
  locked: boolean;
  render: LayerRender;
  color_mode: LayerColorMode;
  transform: LayerTransform;
}

export interface Composition {
  version: 1;
  name: string;
  layers: LayerSettings[];
}

/** Distinct layer colours (same order as the backend's default palette). */
export const LAYER_PALETTE = ["#ef8a3d", "#4db5cf", "#c27ad6", "#8ebd4c", "#e2bd48", "#e56a7c", "#6d95ee", "#d6dae0"];
