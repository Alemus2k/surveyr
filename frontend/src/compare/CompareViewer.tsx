import { useEffect, useMemo, useRef, useState } from "react";
import { SliceDock, type SliceExtent, type SliceLayer } from "../slice/SliceDock";
import type { SliceSpec } from "../slice/slice";
import { niceStep } from "../viewer/backdrop";
import type { ProjectRef } from "../api";
import { Icon } from "../layout/icons";
import { Compass, useCompass } from "../viewer/Compass";
import { colorize } from "../viewer/prepare";
import type { ViewPreset } from "../viewer/stage";
import { CameraGroup, SliderGroup } from "../viewer/ViewerToolbar";
import { createCompareScene, type CompareLayerInput, type CompareScene, type GizmoMode } from "./compareScene";
import { combinedRange, worldPoints } from "./frame";
import type { CompositionState } from "./useComposition";

const POINT_SCALE_MIN = 0.4;
const POINT_SCALE_MAX = 3;

interface CompareViewerProps {
  state: CompositionState;
  projects: ProjectRef[];
  selected: string | null;
  gizmoMode: GizmoMode;
  onGizmoMode: (mode: GizmoMode) => void;
  accent: string; // viewport highlight (slice band)
}

const SLICE_THICKNESS_DIVISOR = 60; // default band ≈ span / 60

/** Full-bleed viewport overlaying every layer of a comparison. */
export function CompareViewer({ state, projects, selected, gizmoMode, onGizmoMode, accent }: CompareViewerProps) {
  const { comp, data, frame, updateLayer } = state;
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CompareScene | null>(null);
  const { dialRef, onHeading } = useCompass();
  const [pointScale, setPointScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [sliceOpen, setSliceOpen] = useState(false);
  const [sliceState, setSliceState] = useState<{ frame: unknown; spec: SliceSpec } | null>(null);
  const updateRef = useRef(updateLayer);
  updateRef.current = updateLayer;

  const loaded = useMemo(
    () =>
      (comp?.layers ?? []).flatMap((s) => {
        const d = data.get(s.project_id);
        return d ? [{ s, d }] : [];
      }),
    [comp, data]
  );
  const zKey = loaded.map((l) => l.s.project_id).join("\n");
  const range = useMemo(() => combinedRange(loaded.map((l) => l.d.z)), [zKey]); // only when the layer set changes
  const colors = useMemo(() => {
    const out = new Map<string, Float32Array>();
    for (const { s, d } of loaded) out.set(s.project_id, colorize(d.z, range));
    return out;
  }, [zKey, range]);

  // the band resets when the comparison's frame changes (layers added/removed)
  const slice: SliceSpec | null = frame
    ? sliceState?.frame === frame
      ? sliceState.spec
      : { axis: "ew", offset: 0, thickness: niceStep(frame.span / SLICE_THICKNESS_DIVISOR) }
    : null;
  const names = new Map(projects.map((p) => [p.id, p.name]));
  // each visible layer as the 3D view places it (only computed while the slice is open)
  const sliceLayers = useMemo<SliceLayer[]>(() => {
    if (!sliceOpen || !frame) return [];
    return loaded
      .filter(({ s }) => s.visible)
      .map(({ s, d }) => ({
        key: s.project_id,
        label: names.get(s.project_id) ?? s.project_id,
        source: worldPoints(d.xyz, d.extent, frame, s.transform, d.base),
        colors: colors.get(s.project_id) ?? null,
        solid: s.color_mode === "layer" ? s.color : null,
      }));
  }, [sliceOpen, frame, loaded, colors, projects]);
  const sliceExtent = useMemo<SliceExtent | null>(() => {
    if (!frame) return null;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const l of sliceLayers) {
      for (const z of l.source.elevation) {
        if (z < zMin) zMin = z;
        if (z > zMax) zMax = z;
      }
    }
    if (zMin === Infinity) [zMin, zMax] = [frame.origin.z, frame.origin.z + frame.box.height / frame.exaggeration];
    return { box: frame.box, span: frame.span, zMin, zMax };
  }, [frame, sliceLayers]);

  useEffect(() => {
    const el = host.current;
    if (!el || !frame) return;
    const s = createCompareScene(el, frame, onHeading, (id, transform) => updateRef.current(id, { transform }));
    sceneRef.current = s;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) s.resize(width, height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      s.dispose();
      sceneRef.current = null;
    };
  }, [frame, onHeading]);

  useEffect(() => {
    const inputs: CompareLayerInput[] = loaded.flatMap(({ s, d }) => {
      const c = colors.get(s.project_id);
      return c ? [{ settings: s, data: d, colors: c }] : [];
    });
    sceneRef.current?.sync(inputs, range);
  }, [loaded, colors, range, frame]);

  const selectedLayer = comp?.layers.find((l) => l.project_id === selected);
  const gizmoTarget = selectedLayer && !selectedLayer.locked && selectedLayer.visible ? selected : null;
  useEffect(() => sceneRef.current?.select(gizmoTarget, gizmoMode), [gizmoTarget, gizmoMode, frame, loaded.length]);
  useEffect(() => sceneRef.current?.setPointScale(pointScale), [pointScale, frame]);
  useEffect(() => sceneRef.current?.setGridVisible(showGrid), [showGrid, frame]);
  useEffect(() => sceneRef.current?.setSlice(sliceOpen ? slice : null), [sliceOpen, slice, frame]);
  useEffect(() => sceneRef.current?.setAccent(accent), [accent, frame]);

  const goTo = (preset: ViewPreset) => sceneRef.current?.goTo(preset);

  return (
    <>
      <div ref={host} className="viewport">
        <div className="viewport-toolbar">
          <CameraGroup onView={goTo} />
          <div className="tool-group" role="group" aria-label="Move selected layer">
            <button
              className="tool-btn"
              aria-pressed={gizmoMode === "translate"}
              onClick={() => onGizmoMode("translate")}
              title="Move layer (drag the arrows)"
              aria-label="Move layer"
              disabled={!gizmoTarget}
            >
              <Icon name="move" />
            </button>
            <button
              className="tool-btn"
              aria-pressed={gizmoMode === "rotate"}
              onClick={() => onGizmoMode("rotate")}
              title="Rotate layer about vertical"
              aria-label="Rotate layer"
              disabled={!gizmoTarget}
            >
              <Icon name="rotate" />
            </button>
          </div>
          <SliderGroup
            label="Point size"
            icon="points"
            min={POINT_SCALE_MIN}
            max={POINT_SCALE_MAX}
            step={0.1}
            value={pointScale}
            onChange={setPointScale}
          />
          <div className="tool-group" role="group" aria-label="Overlays">
            <button className="tool-btn" aria-pressed={showGrid} onClick={() => setShowGrid((g) => !g)} title="Grid backdrop" aria-label="Grid backdrop">
              <Icon name="grid" />
            </button>
            <button className="tool-btn" aria-pressed={sliceOpen} onClick={() => setSliceOpen((o) => !o)} title="Cross-section slice" aria-label="Cross-section slice">
              <Icon name="slice" />
            </button>
          </div>
        </div>

        <ul className="layer-legend" aria-label="Layers">
          {comp?.layers.map((l) => (
            <li key={l.project_id} data-hidden={!l.visible} data-selected={l.project_id === selected}>
              <span className="legend-swatch" style={{ background: l.color_mode === "layer" ? l.color : undefined }} data-elevation={l.color_mode === "elevation"} />
              {names.get(l.project_id) ?? l.project_id}
              {!data.has(l.project_id) && <span className="legend-loading">loading…</span>}
            </li>
          ))}
        </ul>

        {frame && frame.exaggeration > 1.05 && (
          <div className="pc-badges">
            <span className="pc-chip mono">Vertical ×{frame.exaggeration.toFixed(1)}</span>
          </div>
        )}

        <Compass dialRef={dialRef} onTopView={() => goTo("top")} />
      </div>
      {sliceOpen && slice && sliceExtent && (
        <SliceDock
          layers={sliceLayers}
          extent={sliceExtent}
          spec={slice}
          onSpec={(spec) => setSliceState({ frame, spec })}
          onClose={() => setSliceOpen(false)}
        />
      )}
    </>
  );
}
