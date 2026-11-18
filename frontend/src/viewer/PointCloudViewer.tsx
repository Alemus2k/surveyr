import { useEffect, useRef, useState, type ReactNode } from "react";
import { MeasureOverlay } from "../measure/MeasureOverlay";
import type { MeasureController } from "../measure/useMeasure";
import { elevationCssGradient } from "../color";
import { formatElevation, useUnitSystem } from "../lib/units";
import type { SliceSpec } from "../slice/slice";
import { Compass, useCompass } from "./Compass";
import type { ColorRange, PreparedCloud } from "./prepare";
import { createViewerScene, surfaceGridStep, type Outline, type RenderMode, type ViewerScene, type ViewPreset } from "./scene";
import type { SurfaceGrid } from "./surface";

/** A view change request; bump ``n`` to repeat the same preset. */
export interface ViewRequest {
  preset: ViewPreset;
  n: number;
}

interface PointCloudViewerProps {
  cloud: PreparedCloud;
  colors: Float32Array;
  range: ColorRange;
  pointScale: number;
  showGrid: boolean;
  slice: SliceSpec | null;
  view: ViewRequest | null;
  accent: string; // highlight for the dark viewport (slice outline)
  renderMode: RenderMode;
  surfaceGrid: SurfaceGrid | null;
  surfaceOpacity: number;
  onTopView: () => void;
  toolbar: ReactNode;
  outlines?: Outline[]; // closed outlines drawn over the points (job-site zones)
  legend?: ReactNode; // replaces the elevation colour scale
  highest?: number | null; // elevation for the up-axis chip; matches the Terrain panel (highest ground cell)
  /** Opt-in measuring tools (state from useMeasure; put a MeasureGroup in the toolbar). */
  measure?: MeasureController;
}

/** Full-bleed 3D viewport (particles or gridded surface) with legend, compass and a toolbar slot. */
export function PointCloudViewer(props: PointCloudViewerProps) {
  const units = useUnitSystem(); // grid spacing and axis chips are built into the scene, so a switch rebuilds it
  return <SceneViewer key={units} {...props} />;
}

function SceneViewer(props: PointCloudViewerProps) {
  const { cloud, colors, range, pointScale, showGrid, slice, view, accent, onTopView, toolbar } = props;
  const { renderMode, surfaceGrid, surfaceOpacity, outlines, legend, highest } = props;
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ViewerScene | null>(null);
  const [scene, setScene] = useState<ViewerScene | null>(null); // for overlays that render with the scene
  const colorsRef = useRef(colors);
  colorsRef.current = colors;
  const { dialRef, onHeading } = useCompass();

  useEffect(() => {
    const el = host.current;
    if (!el || cloud.count === 0) return;
    const s = createViewerScene(el, cloud, colorsRef.current, onHeading);
    sceneRef.current = s;
    setScene(s);
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) s.resize(width, height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      s.dispose();
      sceneRef.current = null;
      setScene(null);
    };
  }, [cloud, onHeading]);

  useEffect(() => sceneRef.current?.setColors(colors), [colors]);
  useEffect(() => {
    if (highest != null && Number.isFinite(highest)) sceneRef.current?.setHighest(highest);
  }, [cloud, highest]);
  useEffect(() => sceneRef.current?.setPointScale(pointScale), [pointScale, cloud]);
  useEffect(() => sceneRef.current?.setGridVisible(showGrid), [showGrid, cloud]);
  useEffect(() => sceneRef.current?.setSlice(slice), [slice, cloud]);
  useEffect(() => sceneRef.current?.setAccent(accent), [accent, cloud]);
  useEffect(() => sceneRef.current?.setSurface(surfaceGrid, range), [surfaceGrid, range.min, range.max, cloud]);
  useEffect(() => sceneRef.current?.setRenderMode(renderMode), [renderMode, cloud]);
  useEffect(() => sceneRef.current?.setSurfaceOpacity(surfaceOpacity), [surfaceOpacity, cloud]);
  useEffect(() => sceneRef.current?.setOutlines(outlines ?? []), [outlines, cloud]);
  useEffect(() => {
    if (view) sceneRef.current?.goTo(view.preset);
  }, [view]);

  return (
    <div ref={host} className="viewport">
      <div className="viewport-toolbar">{toolbar}</div>

      {legend ?? (
        <div className="pc-legend" aria-label="Elevation colour scale">
          <span className="pc-chip mono">{formatElevation(range.max)}</span>
          <div className="pc-legend-bar" style={{ background: elevationCssGradient() }} />
          <span className="pc-chip mono">{formatElevation(range.min)}</span>
        </div>
      )}

      <div className="pc-badges">
        {cloud.exaggeration > 1.05 && <span className="pc-chip mono">Vertical ×{cloud.exaggeration.toFixed(1)}</span>}
        {renderMode === "surface" && (
          <span className="pc-chip mono">Surface grid {surfaceGridStep(cloud).label}</span>
        )}
      </div>

      <Compass dialRef={dialRef} onTopView={onTopView} />

      {props.measure && scene && <MeasureOverlay scene={scene} controller={props.measure} />}
    </div>
  );
}
