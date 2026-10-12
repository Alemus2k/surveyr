import { useMemo, useState } from "react";
import { SliceDock, type SliceExtent, type SliceLayer } from "../slice/SliceDock";
import type { Analysis } from "../types";
import type { SliceSpec } from "../slice/slice";
import { niceStep } from "./backdrop";
import { PointCloudViewer, type ViewRequest } from "./PointCloudViewer";
import type { ColorRange, PreparedCloud } from "./prepare";
import type { RenderMode, ViewPreset } from "./scene";
import type { SurfaceGrid } from "./surface";
import { ViewerToolbar } from "./ViewerToolbar";

const SLICE_THICKNESS_DIVISOR = 60; // default band ≈ span / 60

interface WorkspaceProps {
  cloud: PreparedCloud;
  colors: Float32Array;
  range: ColorRange;
  accent: string; // viewport highlight
  analysis: Analysis; // elevation grid + scanned mask for the surface mode
}

const DEFAULT_SURFACE_OPACITY = 0.85;

/** 3D viewport + toolbar + optional slice dock; owns the view-only settings. */
export function Workspace({ cloud, colors, range, accent, analysis }: WorkspaceProps) {
  const [pointScale, setPointScale] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [renderMode, setRenderMode] = useState<RenderMode>("points");
  const [surfaceOpacity, setSurfaceOpacity] = useState(DEFAULT_SURFACE_OPACITY);
  const surfaceGrid = useMemo<SurfaceGrid>(() => {
    const z = analysis.maps.elevation.data;
    return {
      x: analysis.grid.x,
      y: analysis.grid.y,
      z,
      mask: analysis.maps.mask?.data ?? z.map((row) => row.map(() => 1)),
    };
  }, [analysis]);
  const [view, setView] = useState<ViewRequest | null>(null);
  const [sliceOpen, setSliceOpen] = useState(false);
  const [sliceState, setSliceState] = useState<{ cloud: PreparedCloud; spec: SliceSpec } | null>(null);

  // the slice resets when a different cloud is shown
  const slice: SliceSpec =
    sliceState?.cloud === cloud
      ? sliceState.spec
      : { axis: "ew", offset: 0, thickness: niceStep(cloud.span / SLICE_THICKNESS_DIVISOR) };
  const sliceLayers = useMemo<SliceLayer[]>(
    () => [{ key: "scan", label: "Scan", source: { positions: cloud.positions, elevation: cloud.z }, colors, solid: null }],
    [cloud, colors]
  );
  const sliceExtent = useMemo<SliceExtent>(
    () => ({ box: cloud.box, span: cloud.span, zMin: cloud.zMin, zMax: cloud.zMax }),
    [cloud]
  );
  const goTo = (preset: ViewPreset) => setView((v) => ({ preset, n: (v?.n ?? 0) + 1 }));

  return (
    <>
      <PointCloudViewer
        highest={analysis.stats.max}
        cloud={cloud}
        colors={colors}
        range={range}
        pointScale={pointScale}
        showGrid={showGrid}
        slice={sliceOpen ? slice : null}
        view={view}
        accent={accent}
        renderMode={renderMode}
        surfaceGrid={renderMode === "surface" ? surfaceGrid : null}
        surfaceOpacity={surfaceOpacity}
        onTopView={() => goTo("top")}
        toolbar={
          <ViewerToolbar
            onView={goTo}
            renderMode={renderMode}
            onRenderMode={setRenderMode}
            surfaceOpacity={surfaceOpacity}
            onSurfaceOpacity={setSurfaceOpacity}
            pointScale={pointScale}
            onPointScale={setPointScale}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((g) => !g)}
            sliceOpen={sliceOpen}
            onToggleSlice={() => setSliceOpen((o) => !o)}
          />
        }
      />
      {sliceOpen && (
        <SliceDock
          layers={sliceLayers}
          extent={sliceExtent}
          spec={slice}
          onSpec={(spec) => setSliceState({ cloud, spec })}
          onClose={() => setSliceOpen(false)}
        />
      )}
    </>
  );
}
