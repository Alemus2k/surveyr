import { useState } from "react";
import type { ProjectRef } from "../api";
import { Icon } from "../layout/icons";
import { PanelSection } from "../panels/SidePanel";
import type { CompositionState } from "./useComposition";
import { LAYER_PALETTE, type LayerSettings, type LayerTransform } from "./types";

const IDENTITY: LayerTransform = { tx: 0, ty: 0, tz: 0, yaw_deg: 0 };
const MAX_LAYERS = 12;

interface LayersPanelProps {
  state: CompositionState;
  projects: ProjectRef[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface NumberFieldProps {
  label: string;
  unit: string;
  value: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
}

function NumberField({ label, unit, value, step, disabled, onChange }: NumberFieldProps) {
  return (
    <label className="xf-field">
      <span>{label}</span>
      <input
        type="number"
        className="mono"
        step={step}
        value={Number(value.toFixed(4))}
        disabled={disabled}
        onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)}
      />
      <span className="unit">{unit}</span>
    </label>
  );
}

/** Side panel for a comparison: one card per layer, plus "add layer". */
export function LayersPanel({ state, projects, selected, onSelect }: LayersPanelProps) {
  const { comp, data, saveError, update, updateLayer } = state;
  const [adding, setAdding] = useState("");
  if (!comp) return <div className="empty-state">Loading comparison…</div>;

  const names = new Map(projects.map((p) => [p.id, p.name]));
  const inUse = new Set(comp.layers.map((l) => l.project_id));
  const addable = projects.filter((p) => p.type !== "compare" && !inUse.has(p.id));

  const setTransform = (layer: LayerSettings, patch: Partial<LayerTransform>) =>
    updateLayer(layer.project_id, { transform: { ...layer.transform, ...patch } });

  const addLayer = (id: string) => {
    if (!id) return;
    update((c) => ({
      ...c,
      layers: [
        ...c.layers,
        {
          project_id: id,
          color: LAYER_PALETTE.find((p) => !c.layers.some((l) => l.color === p)) ?? LAYER_PALETTE[c.layers.length % LAYER_PALETTE.length],
          opacity: 1,
          visible: true,
          locked: false,
          render: "points",
          color_mode: "layer",
          transform: { ...IDENTITY },
        },
      ],
    }));
    setAdding("");
  };
  const removeLayer = (id: string) => {
    if (selected === id) onSelect(null);
    update((c) => ({ ...c, layers: c.layers.filter((l) => l.project_id !== id) }));
  };

  return (
    <>
      <PanelSection>
        <ul className="layer-list">
          {comp.layers.map((layer) => {
            const isSel = layer.project_id === selected;
            const name = names.get(layer.project_id) ?? layer.project_id;
            return (
              <li key={layer.project_id} className="layer-card" data-selected={isSel} data-hidden={!layer.visible}>
                <div className="layer-row">
                  <label className="layer-color" title="Layer colour">
                    <input
                      type="color"
                      value={layer.color}
                      onChange={(e) => updateLayer(layer.project_id, { color: e.target.value })}
                      aria-label={`${name} colour`}
                    />
                  </label>
                  <button className="layer-name" onClick={() => onSelect(isSel ? null : layer.project_id)} aria-pressed={isSel} title={isSel ? "Deselect" : "Select to move / rotate"}>
                    {name}
                    {!data.has(layer.project_id) && <span className="layer-sub">loading…</span>}
                  </button>
                  <button
                    className="tool-btn"
                    onClick={() => updateLayer(layer.project_id, { visible: !layer.visible })}
                    aria-label={layer.visible ? `Hide ${name}` : `Show ${name}`}
                    title={layer.visible ? "Hide" : "Show"}
                  >
                    <Icon name={layer.visible ? "eye" : "eyeOff"} size={16} />
                  </button>
                  <button
                    className="tool-btn"
                    aria-pressed={layer.locked}
                    onClick={() => updateLayer(layer.project_id, { locked: !layer.locked })}
                    aria-label={layer.locked ? `Unlock ${name}` : `Lock ${name}`}
                    title={layer.locked ? "Unlock position" : "Lock position"}
                  >
                    <Icon name={layer.locked ? "lock" : "unlock"} size={16} />
                  </button>
                </div>

                <label className="layer-opacity">
                  <span className="field-label">Opacity</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={layer.opacity}
                    onChange={(e) => updateLayer(layer.project_id, { opacity: e.target.valueAsNumber })}
                    aria-label={`${name} opacity`}
                  />
                  <output className="mono">{Math.round(layer.opacity * 100)}%</output>
                </label>

                <div className="layer-toggles">
                  <div className="segmented" role="group" aria-label={`${name} render as`}>
                    <button aria-pressed={layer.render === "points"} onClick={() => updateLayer(layer.project_id, { render: "points" })}>
                      Points
                    </button>
                    <button aria-pressed={layer.render === "surface"} onClick={() => updateLayer(layer.project_id, { render: "surface" })}>
                      Surface
                    </button>
                  </div>
                  <div className="segmented" role="group" aria-label={`${name} colour by`}>
                    <button aria-pressed={layer.color_mode === "layer"} onClick={() => updateLayer(layer.project_id, { color_mode: "layer" })}>
                      Layer
                    </button>
                    <button aria-pressed={layer.color_mode === "elevation"} onClick={() => updateLayer(layer.project_id, { color_mode: "elevation" })}>
                      Height
                    </button>
                  </div>
                </div>

                {isSel && (
                  <div className="layer-transform">
                    <div className="xf-grid">
                      <NumberField label="East" unit="m" step={0.01} value={layer.transform.tx} disabled={layer.locked} onChange={(v) => setTransform(layer, { tx: v })} />
                      <NumberField label="North" unit="m" step={0.01} value={layer.transform.ty} disabled={layer.locked} onChange={(v) => setTransform(layer, { ty: v })} />
                      <NumberField label="Up" unit="m" step={0.01} value={layer.transform.tz} disabled={layer.locked} onChange={(v) => setTransform(layer, { tz: v })} />
                      <NumberField label="Yaw" unit="°" step={0.5} value={layer.transform.yaw_deg} disabled={layer.locked} onChange={(v) => setTransform(layer, { yaw_deg: Math.max(-360, Math.min(360, v)) })} />
                    </div>
                    <div className="layer-actions">
                      <button className="text-btn" disabled={layer.locked} onClick={() => updateLayer(layer.project_id, { transform: { ...IDENTITY } })}>
                        Reset position
                      </button>
                      <button className="text-btn danger" onClick={() => removeLayer(layer.project_id)}>
                        Remove layer
                      </button>
                    </div>
                    <p className="panel-note">
                      {layer.locked ? "Unlock to move this layer." : "Drag the handles in the 3D view, or type exact values."}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {comp.layers.length === 0 && <p className="panel-note">This comparison has no layers left. Add one below.</p>}
      </PanelSection>

      <PanelSection label="Add layer">
        {addable.length && comp.layers.length < MAX_LAYERS ? (
          <div className="add-layer">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Scan to add">
              <option value="">Choose a scan…</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="secondary-btn" disabled={!adding} onClick={() => addLayer(adding)}>
              Add
            </button>
          </div>
        ) : (
          <p className="panel-note">
            {comp.layers.length >= MAX_LAYERS ? `Up to ${MAX_LAYERS} layers.` : "Every scan is already a layer. Import more from Projects."}
          </p>
        )}
        {saveError && <p className="panel-note error-text">{saveError}</p>}
      </PanelSection>
    </>
  );
}
