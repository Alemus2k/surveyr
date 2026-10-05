import { Icon } from "../layout/icons";
import type { RenderMode, ViewPreset } from "./scene";

const POINT_SCALE_MIN = 0.4;
const POINT_SCALE_MAX = 3;
const OPACITY_MIN = 0.15;

// ---------------------------------------------------------------- groups (shared)

export function CameraGroup({ onView }: { onView: (preset: ViewPreset) => void }) {
  return (
    <div className="tool-group" role="group" aria-label="Camera">
      <button className="tool-btn" onClick={() => onView("perspective")} title="Perspective view" aria-label="Perspective view">
        <Icon name="cube" />
      </button>
      <button className="tool-btn" onClick={() => onView("top")} title="Top view" aria-label="Top view">
        <Icon name="top" />
      </button>
      <button className="tool-btn" onClick={() => onView("front")} title="Side view, looking north" aria-label="Side view">
        <Icon name="front" />
      </button>
    </div>
  );
}

interface RenderModeGroupProps {
  mode: RenderMode;
  onMode: (mode: RenderMode) => void;
}

export function RenderModeGroup({ mode, onMode }: RenderModeGroupProps) {
  return (
    <div className="tool-group" role="group" aria-label="Render as">
      <button className="tool-btn" aria-pressed={mode === "points"} onClick={() => onMode("points")} title="Points" aria-label="Render as points">
        <Icon name="points" />
      </button>
      <button className="tool-btn" aria-pressed={mode === "surface"} onClick={() => onMode("surface")} title="Smooth surface" aria-label="Render as surface">
        <Icon name="surface" />
      </button>
    </div>
  );
}

interface SliderGroupProps {
  label: string;
  icon: "points" | "opacity";
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

export function SliderGroup({ label, icon, min, max, step, value, onChange }: SliderGroupProps) {
  return (
    <div className="tool-group" role="group" aria-label={label}>
      <span className="tool-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <input
        type="range"
        className="tool-slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </div>
  );
}

// ---------------------------------------------------------------- single-project toolbar

interface ViewerToolbarProps {
  onView: (preset: ViewPreset) => void;
  renderMode: RenderMode;
  onRenderMode: (mode: RenderMode) => void;
  pointScale: number;
  onPointScale: (v: number) => void;
  surfaceOpacity: number;
  onSurfaceOpacity: (v: number) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  sliceOpen: boolean;
  onToggleSlice: () => void;
}

/** Floating viewport toolbar: camera, points/surface, size or opacity, grid and slice toggles. */
export function ViewerToolbar(props: ViewerToolbarProps) {
  const { onView, renderMode, onRenderMode, showGrid, onToggleGrid, sliceOpen, onToggleSlice } = props;
  return (
    <>
      <CameraGroup onView={onView} />
      <RenderModeGroup mode={renderMode} onMode={onRenderMode} />
      {renderMode === "points" ? (
        <SliderGroup
          label="Point size"
          icon="points"
          min={POINT_SCALE_MIN}
          max={POINT_SCALE_MAX}
          step={0.1}
          value={props.pointScale}
          onChange={props.onPointScale}
        />
      ) : (
        <SliderGroup
          label="Surface opacity"
          icon="opacity"
          min={OPACITY_MIN}
          max={1}
          step={0.01}
          value={props.surfaceOpacity}
          onChange={props.onSurfaceOpacity}
        />
      )}
      <div className="tool-group" role="group" aria-label="Overlays">
        <button className="tool-btn" aria-pressed={showGrid} onClick={onToggleGrid} title="Grid backdrop" aria-label="Grid backdrop">
          <Icon name="grid" />
        </button>
        <button className="tool-btn" aria-pressed={sliceOpen} onClick={onToggleSlice} title="Cross-section slice" aria-label="Cross-section slice">
          <Icon name="slice" />
        </button>
      </div>
    </>
  );
}
