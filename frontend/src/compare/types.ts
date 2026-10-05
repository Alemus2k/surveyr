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
export const LAYER_PALETTE = ["#ff7a1a", "#22d3ee", "#e45bff", "#9be32d", "#ffd23f", "#ff5d73", "#5b8cff", "#f0f0f0"];
