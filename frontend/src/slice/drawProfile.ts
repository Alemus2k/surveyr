import { niceStep } from "../viewer/backdrop";
import type { SliceSample } from "./slice";

/** One layer's points in the band, drawn in a flat colour or per-point colours. */
export interface ProfileSeries {
  label: string;
  sample: SliceSample;
  colors: Float32Array | null; // per source point (rgb 0..1); used when solid is null
  solid: string | null;
}

/** Horizontal span and elevation range the profile is fitted to. */
export interface ProfileExtent {
  span: number;
  zMin: number;
  zMax: number;
}

const PAD = { left: 52, right: 16, top: 14, bottom: 22 };
const MAX_PROFILE_EXAGGERATION = 5;
const BG = "#04060a";
const GRID = "rgba(255,255,255,0.07)";
const LABEL = "rgba(230,238,247,0.55)";
const FONT = "11px 'IBM Plex Mono', ui-monospace, monospace";
const DOT = 1.2;
const JET_SWATCH = ["#1428ff", "#00dcff", "#28ff3c", "#fff000", "#ff1e0a"];

/** Where the plot sits on a ``w`` x ``h`` canvas and how profile coordinates map to pixels. */
export interface ProfileLayout {
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  zLo: number;
  zHi: number;
  sx: number; // px per metre along the section
  sz: number; // px per metre of elevation
  toX: (u: number) => number;
  toY: (z: number) => number;
  fromX: (x: number) => number;
}

export function profileLayout(w: number, h: number, extent: ProfileExtent): ProfileLayout {
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const uHalf = extent.span / 2;
  const zLo = extent.zMin;
  const zHi = Math.max(extent.zMax, zLo + 1e-6);
  const sx = plotW / (2 * uHalf);
  const sz = Math.min(plotH / (zHi - zLo), sx * MAX_PROFILE_EXAGGERATION);
  const zBase = PAD.top + plotH - (plotH - (zHi - zLo) * sz) / 2; // centre short profiles vertically
  return {
    plotLeft: PAD.left,
    plotRight: w - PAD.right,
    plotTop: PAD.top,
    plotBottom: PAD.top + plotH,
    zLo,
    zHi,
    sx,
    sz,
    toX: (u) => PAD.left + (u + uHalf) * sx,
    toY: (z) => zBase - (z - zLo) * sz,
    fromX: (x) => (x - PAD.left) / sx - uHalf,
  };
}

/**
 * Paint a cross-section onto ``canvas``: horizontal = distance along the
 * section, vertical = true elevation (stretched at most 5x when very flat).
 * Series are drawn in order, so later layers sit on top.
 */
export function drawProfile(canvas: HTMLCanvasElement, series: ProfileSeries[], extent: ProfileExtent): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  const { zLo, zHi, sx, sz, toX, toY } = profileLayout(w, h, extent);
  const plotH = h - PAD.top - PAD.bottom;

  // elevation grid lines + labels
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  const step = niceStep((zHi - zLo) / 3);
  for (let z = Math.ceil(zLo / step) * step; z <= zHi + 1e-9; z += step) {
    const y = toY(z);
    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(w - PAD.right, y);
    ctx.stroke();
    ctx.fillStyle = LABEL;
    ctx.fillText(`${z.toFixed(2)} m`, 6, y);
  }

  // points, layer by layer
  for (const s of series) {
    if (s.solid) ctx.fillStyle = s.solid;
    for (let k = 0; k < s.sample.u.length; k++) {
      if (!s.solid && s.colors) {
        const i = s.sample.index[k];
        ctx.fillStyle = `rgb(${(s.colors[i * 3] * 255) | 0},${(s.colors[i * 3 + 1] * 255) | 0},${(s.colors[i * 3 + 2] * 255) | 0})`;
      }
      ctx.fillRect(toX(s.sample.u[k]) - DOT, toY(s.sample.z[k]) - DOT, DOT * 2, DOT * 2);
    }
  }

  // legend (only useful with several layers)
  if (series.length > 1) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    series.forEach((s, i) => {
      const y = PAD.top + 8 + i * 15;
      const textW = ctx.measureText(s.label).width;
      ctx.fillStyle = "rgba(230,238,247,0.8)";
      ctx.fillText(s.label, w - PAD.right, y);
      const x = w - PAD.right - textW - 14;
      if (s.solid) {
        ctx.fillStyle = s.solid;
      } else {
        const g = ctx.createLinearGradient(x, 0, x + 8, 0); // height-coloured layer: mini ramp
        JET_SWATCH.forEach((c, j) => g.addColorStop(j / (JET_SWATCH.length - 1), c));
        ctx.fillStyle = g;
      }
      ctx.fillRect(x, y - 4, 8, 8);
    });
  }

  const exaggeration = sz / sx;
  ctx.fillStyle = LABEL;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "right";
  ctx.fillText(exaggeration > 1.05 ? `vertical ×${exaggeration.toFixed(1)}` : "true scale", w - PAD.right, h - 6);
  ctx.textAlign = "left";
  if (series.every((s) => s.sample.u.length === 0)) {
    ctx.fillText("No points in this band — move the slice or make it thicker.", PAD.left, PAD.top + plotH / 2);
  }
}
