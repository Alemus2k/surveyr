import { useEffect, useMemo, useRef } from "react";
import { Icon } from "../layout/icons";
import type { SceneBox } from "../viewer/backdrop";
import { niceStep } from "../viewer/backdrop";
import { drawProfile, type ProfileSeries } from "./drawProfile";
import { selectSliceFrom, sliceHalfRange, type SliceAxis, type SliceSource, type SliceSpec } from "./slice";

/** One thing to cut through: a single scan, or one layer of a comparison. */
export interface SliceLayer {
  key: string;
  label: string;
  source: SliceSource;
  colors: Float32Array | null; // per-point colours, used when solid is null
  solid: string | null; // flat layer colour
}

/** The view the slice lives in: scene box (for the slider range) and profile fit. */
export interface SliceExtent {
  box: SceneBox;
  span: number;
  zMin: number;
  zMax: number;
}

interface SliceDockProps {
  layers: SliceLayer[];
  extent: SliceExtent;
  spec: SliceSpec;
  onSpec: (s: SliceSpec) => void;
  onClose: () => void;
}

/** Bottom dock: a side-on cross-section through a thin band of one or more layers. */
export function SliceDock({ layers, extent, spec, onSpec, onClose }: SliceDockProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const series = useMemo<ProfileSeries[]>(
    () =>
      layers.map((l) => ({ label: l.label, sample: selectSliceFrom(l.source, spec), colors: l.colors, solid: l.solid })),
    [layers, spec]
  );
  const total = series.reduce((n, s) => n + s.sample.u.length, 0);
  const half = sliceHalfRange(extent, spec.axis);
  const thickStep = niceStep(extent.span / 200);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const paint = () => drawProfile(cv, series, extent);
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [series, extent]);

  const setAxis = (axis: SliceAxis) => onSpec({ ...spec, axis, offset: 0 });
  const setThickness = (t: number) =>
    onSpec({ ...spec, thickness: Math.max(thickStep, Math.round(t / thickStep) * thickStep) });

  return (
    <section className="slice-dock" aria-label="Cross-section">
      <div className="slice-bar">
        <span className="slice-title">
          <Icon name="slice" size={16} /> Slice
        </span>
        <select value={spec.axis} onChange={(e) => setAxis(e.target.value as SliceAxis)} aria-label="Section direction">
          <option value="ew">East – West</option>
          <option value="ns">North – South</option>
        </select>
        <label className="slice-field">
          <span>{spec.axis === "ew" ? "Northing" : "Easting"}</span>
          <input
            type="range"
            min={-half}
            max={half}
            step={half / 200 || 0.01}
            value={spec.offset}
            onChange={(e) => onSpec({ ...spec, offset: e.target.valueAsNumber })}
          />
          <output className="mono">{spec.offset >= 0 ? "+" : "−"}{Math.abs(spec.offset).toFixed(2)} m</output>
        </label>
        <div className="slice-field">
          <span id="thickness-label">Thickness</span>
          <div className="stepper" role="group" aria-labelledby="thickness-label">
            <button aria-label="Thinner" onClick={() => setThickness(spec.thickness - thickStep)}>‹</button>
            <output>{spec.thickness.toFixed(2)} m</output>
            <button aria-label="Thicker" onClick={() => setThickness(spec.thickness + thickStep)}>›</button>
          </div>
        </div>
        <span className="slice-count mono">{total.toLocaleString()} pts</span>
        <button className="tool-btn slice-close" onClick={onClose} aria-label="Close slice" title="Close slice">
          <Icon name="close" size={16} />
        </button>
      </div>
      <canvas ref={canvas} className="slice-canvas" aria-label="Cross-section profile" />
    </section>
  );
}
