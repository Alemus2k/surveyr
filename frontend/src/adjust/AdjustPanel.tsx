import { useState } from "react";
import type { ScanSettings } from "../api";
import { formatDimensions, fromDisplay, inputStep, inputValue, unitOf } from "../lib/units";
import { PanelSection } from "../panels/SidePanel";
import type { Analysis } from "../types";
import { unitLabel, UNITS } from "./units";
import type { ScanSettingsState } from "./useScanSettings";

interface AdjustPanelProps {
  state: ScanSettingsState;
  analysis: Analysis | null; // reflects the settings currently applied
}

const size = (a: Analysis | null) => {
  const d = a?.dimensions;
  return d ? formatDimensions(d.width_m, d.depth_m, d.height_m) : "…";
};

/** Manual adjustments for one scan: source units, up axis, ground-only. */
export function AdjustPanel({ state, analysis }: AdjustPanelProps) {
  const { current, saving, error, save } = state;
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null); // typed but not yet applied
  if (!current) return <div className="empty-state">{error ?? "Loading…"}</div>;
  const { settings, detected } = current;
  const set = (patch: Partial<ScanSettings>) => save({ ...settings, ...patch });
  const suggestion = detected.source === "size" && detected.unit && detected.unit !== settings.unit;
  const crsMismatch = detected.source === "crs" && detected.unit && detected.unit !== settings.unit;
  const groundApplied = analysis?.points.ground_only ?? false;

  return (
    <>
      <PanelSection label="Units">
        {suggestion && detected.unit && (
          <div className="notice-card warn" role="status">
            <p>{detected.reason}</p>
            <button className="secondary-btn" disabled={saving} onClick={() => detected.unit && set({ unit: detected.unit })}>
              Treat as {unitLabel(detected.unit)}
            </button>
          </div>
        )}
        {detected.source === "crs" && (
          <div className={`notice-card ${crsMismatch ? "warn" : "ok"}`} role="status">
            <p>
              The file says it's in <strong>{unitLabel(detected.unit)}</strong> ({detected.crs_name}).
              {crsMismatch ? " Your setting below overrides that." : ""}
            </p>
          </div>
        )}
        <label className="dialog-field">
          <span className="field-label">This file's coordinates are in</span>
          <select value={settings.unit} disabled={saving} onChange={(e) => set({ unit: e.target.value as ScanSettings["unit"] })}>
            {UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <div className="metric-row">
          <dt>Size (W × D × H)</dt>
          <dd className="fig">{size(analysis)}</dd>
        </div>
        <p className="panel-note">
          Everything is converted to metres when the scan loads; the file itself is never changed. Check the size against
          what you measured on site.
        </p>
      </PanelSection>

      <PanelSection label="Orientation">
        <div className="segmented" role="group" aria-label="Up axis">
          <button aria-pressed={settings.up_axis === "z"} disabled={saving} onClick={() => set({ up_axis: "z" })}>
            Z is up
          </button>
          <button aria-pressed={settings.up_axis === "y"} disabled={saving} onClick={() => set({ up_axis: "y" })}>
            Y is up
          </button>
        </div>
        <p className="panel-note">
          Survey LiDAR and most scanning apps use Z-up. If the scan stands on its side (walls lying flat), it was exported
          Y-up — switch here.
        </p>
      </PanelSection>

      {current.surfaces && (
        <PanelSection label="Design surface">
          <label className="dialog-field">
            <span className="field-label">Surface from this LandXML file</span>
            <select
              value={settings.surface ?? current.surfaces.default}
              disabled={saving}
              onChange={(e) => set({ surface: e.target.value === current.surfaces!.default ? null : e.target.value })}
            >
              {current.surfaces.available.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.faces.toLocaleString()} triangles)
                </option>
              ))}
            </select>
          </label>
          <p className="panel-note">
            Engineers' files often hold existing ground and finished grade together. The one named like finished grade
            is picked by default; it's sampled on a fine grid so every tool can use it.
          </p>
        </PanelSection>
      )}

      <PanelSection label="Classification">
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.ground_only}
            disabled={saving}
            onChange={(e) => set({ ground_only: e.target.checked })}
          />
          Use ground points only
        </label>
        <p className="panel-note">
          {groundApplied
            ? `Using ${analysis?.points.captured.toLocaleString()} ground-classified points; trees, buildings and other classes are left out of the terrain.`
            : settings.ground_only
              ? "This scan isn't ground-classified (phone scans never are), so every point is used."
              : "Every point is used, including vegetation and structures if the scan has them."}
        </p>
      </PanelSection>

      <PanelSection label="Elevation correction">
        <label className="js-field">
          <span className="field-label">Add to every elevation</span>
          <span className="js-input">
            <input
              type="number"
              className="fig"
              step={inputStep("small", 0.1)}
              min={inputValue(-10, "small")}
              max={inputValue(10, "small")}
              value={offsetDraft ?? String(inputValue(settings.z_offset_m, "small"))}
              disabled={saving}
              onChange={(e) => setOffsetDraft(e.target.value)}
              // apply on Enter / leaving the field: every change reloads the scan and anything built on it
              onBlur={() => {
                const typed = Number(offsetDraft);
                // saved only when the figure shown was changed, so the stored correction never drifts
                if (offsetDraft !== null && offsetDraft.trim() !== "" && Number.isFinite(typed) && typed !== inputValue(settings.z_offset_m, "small"))
                  set({ z_offset_m: fromDisplay(typed, "small") });
                setOffsetDraft(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <span className="unit">{unitOf("small")}</span>
          </span>
        </label>
        <p className="panel-note">
          Shifts the whole scan up (+) or down (−), e.g. to fix a base-station height error. Control &amp; accuracy can
          work this out from surveyed check points.
        </p>
      </PanelSection>

      <PanelSection label="Coordinate system">
        <p className="panel-note">
          {detected.crs_name
            ? `${detected.crs_name}${detected.epsg ? ` (EPSG:${detected.epsg})` : ""}.`
            : "None recorded. Phone scans have no real-world position or true north; survey LiDAR files usually do."}
        </p>
        {error && <p className="panel-note error-text">{error}</p>}
      </PanelSection>
    </>
  );
}
