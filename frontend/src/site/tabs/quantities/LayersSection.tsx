import { useMemo, useState } from "react";
import { QuantityInput } from "../../../components/QuantityInput";
import { ConfirmDialog } from "../../../layout/ConfirmDialog";
import { Icon } from "../../../layout/icons";
import { formatArea, formatCoordinate, formatDensity, formatThickness, formatTonnage, formatVolume, quantityText } from "../../../lib/units";
import { formatDate } from "../../dates";
import { paintLayer, PlanView, type PlanShape, type ReadoutRow } from "../../PlanView";
import { DRONE_ACCURACY_M, LayerCell, LAYER_MATERIALS, layerPreset, layerReliability, type ThinPatch } from "../../quantities";
import { CUT, ON_GRADE } from "../../siteColors";
import type { Layer } from "../../types";
import type { SiteTabProps } from "../types";
import type { LayerResult } from "./model";

const THICK: [number, number, number] = [226, 172, 52]; // amber: thicker than needed (costs material)
const EDGE: [number, number, number] = [150, 156, 164];
const BAD_HEX = "#d8584e";

const q = (x: { value: string; unit: string }) => quantityText(x);

/** Material placed in layers: thickness against target, volume and tonnage. */
export function LayersSection(props: SiteTabProps & { results: LayerResult[] }) {
  const { site, surfaces, scan, state, results } = props;
  const [selectedId, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<"new" | "redraw" | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selected = results.find((r) => r.layer.id === selectedId) ?? results[0] ?? null;
  const m = selected?.measure ?? null;
  const g = surfaces;
  // single thin cells are as likely scan noise as a real low spot: counted in the area, not boxed or listed
  const patches = m ? m.patches.filter((p) => p.cells >= 2) : [];
  const specks = m ? m.patches.length - patches.length : 0;

  const paint = useMemo(() => {
    if (!m) return null;
    return paintLayer(g.nx * g.ny, (i) => {
      switch (m.state[i]) {
        case LayerCell.Ok:
          return [...ON_GRADE, 0.75];
        case LayerCell.Thin:
          return [...CUT, 0.9];
        case LayerCell.Thick:
          return [...THICK, 0.85];
        case LayerCell.Edge:
          return [...EDGE, 0.45];
        default:
          return null;
      }
    });
  }, [m, g.nx, g.ny]);

  const patchShape = (p: ThinPatch, k: number): PlanShape => {
    const [c0, r0, c1, r1] = p.bbox;
    const pad = 0.5;
    const x0 = g.x0 + (c0 - pad) * g.cell, x1 = g.x0 + (c1 + 1 + pad) * g.cell;
    const y0 = g.y0 + (r0 - pad) * g.cell, y1 = g.y0 + (r1 + 1 + pad) * g.cell;
    return { id: `thin${k}`, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], color: BAD_HEX, dashed: true, fill: false };
  };

  const shapes: PlanShape[] = [
    ...results.map((r) => ({
      id: r.layer.id,
      points: r.layer.polygon,
      color: r === selected ? "#eeb02b" : "#9aa0a8",
      label: r.layer.name,
      selected: r === selected,
      fill: false,
    })),
    ...patches.slice(0, 12).map(patchShape),
  ];

  const readout = (i: number): ReadoutRow[] => {
    if (!m || !selected || m.state[i] === LayerCell.None) return [];
    const t = m.thickness[i];
    const st = m.state[i];
    const word =
      st === LayerCell.Thin ? "too thin" : st === LayerCell.Thick ? "thicker than needed" : st === LayerCell.Ok ? "within tolerance" : st === LayerCell.Edge ? "edge — not judged" : "nothing placed";
    return [
      { label: "Thickness", value: formatThickness(t), tone: st === LayerCell.Thin ? "cut" : st === LayerCell.Ok ? "ok" : undefined },
      { label: "vs target", value: formatThickness(t - selected.layer.target_thickness_m, { signed: true }) },
      { label: "", value: word },
    ];
  };

  const update = (id: string, patch: Partial<Layer>) => state.update((s) => ({ ...s, layers: (s.layers ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  const drawn = (polygon: [number, number][]) => {
    if (drawing === "redraw" && selected) update(selected.layer.id, { polygon });
    else {
      const id = `layer${Date.now().toString(36)}`;
      const preset = LAYER_MATERIALS[0];
      state.update((s) => ({
        ...s,
        layers: [
          ...(s.layers ?? []),
          {
            id,
            name: `Layer ${(s.layers?.length ?? 0) + 1}`,
            material: preset.label,
            polygon,
            base_scan: null,
            target_thickness_m: 0.1524, // 6 in
            tolerance_m: 0.0127, // ½ in
            density_t_m3: preset.density,
          },
        ],
      }));
      setSelected(id);
      setEditing(true);
    }
    setDrawing(null);
  };

  const remove = () => {
    if (!selected) return;
    state.update((s) => ({ ...s, layers: (s.layers ?? []).filter((l) => l.id !== selected.layer.id) }));
    setSelected(null);
    setDeleting(false);
    setEditing(false);
  };

  const target = selected?.layer.target_thickness_m ?? 0;
  const minOk = selected ? selected.layer.target_thickness_m - selected.layer.tolerance_m : 0;
  const reliability = selected ? layerReliability(target) : "good";

  return (
    <div className="site-grid">
      <section className="site-card site-map-card">
        <div className="site-card-head">
          {results.length > 1 ? (
            <select className="q-select" value={selected?.layer.id ?? ""} onChange={(e) => setSelected(e.target.value)} aria-label="Layer">
              {results.map((r) => (
                <option key={r.layer.id} value={r.layer.id}>
                  {r.layer.name}
                </option>
              ))}
            </select>
          ) : (
            <strong className="q-head-name">{selected?.layer.name ?? "Layers"}</strong>
          )}
          <div className="site-card-tools">
            <button className={drawing === "new" ? "primary-btn compact" : "secondary-btn"} onClick={() => setDrawing((d) => (d === "new" ? null : "new"))}>
              <Icon name="plus" size={14} /> {drawing === "new" ? "Drawing…" : "Add layer"}
            </button>
          </div>
        </div>
        <PlanView
          grid={g}
          relief={g.scans[scan]}
          layer={paint}
          shapes={shapes}
          readout={readout}
          title={() => selected?.layer.name ?? null}
          onPickShape={(id) => id && results.some((r) => r.layer.id === id) && setSelected(id)}
          draw={
            drawing
              ? {
                  kind: "polygon",
                  hint: drawing === "redraw" ? `Redraw the outline of “${selected?.layer.name}”` : "Click around the area the layer covers (e.g. the road base)",
                  onDone: drawn,
                  onCancel: () => setDrawing(null),
                }
              : null
          }
          ariaLabel="Layer thickness map, north up"
        />
        {m && selected && (
          <div className="site-legend">
            <span>
              <i className="sw ok" /> {formatThickness(minOk)} – {formatThickness(target + selected.layer.tolerance_m)}
            </span>
            <span>
              <i className="sw cut" /> too thin
            </span>
            <span>
              <i className="sw q-thick" /> thicker than needed
            </span>
            <span>
              <i className="sw q-edge" /> edge of the placed area (not judged)
            </span>
            {patches.length > 0 && <span className="site-legend-note">dashed red boxes: thin patches</span>}
          </div>
        )}
      </section>

      <section className="site-card">
        {!selected ? (
          <div className="q-empty">
            <h3>No layers yet</h3>
            <p className="panel-note">
              Click <strong>Add layer</strong> and draw around the area where base course, asphalt or topsoil is going down. The app measures how
              thick it is from the rise between the flight before it was placed and the flight you pick.
            </p>
          </div>
        ) : (
          <>
            <h3>
              {selected.layer.name} <span className="site-card-note">{selected.layer.material || "no material set"}</span>
            </h3>
            <LayerVerdict r={selected} dates={surfaces.dates} scan={scan} />
            {m && (
              <dl className="metric-list">
                <Row label="Placed" hint="Area where the ground rose by more than a placed layer would" value={q(formatArea(m.placedArea))} />
                <Row label="Volume" value={q(formatVolume(m.volume))} />
                <Row
                  label="Weight"
                  hint={selected.layer.density_t_m3 ? `Volume × ${formatDensity(selected.layer.density_t_m3)}` : undefined}
                  value={m.tonnes === null ? "set a density" : q(formatTonnage(m.tonnes))}
                />
                <Row label="Average thickness" value={m.meanThickness === null ? "—" : formatThickness(m.meanThickness)} />
                <Row label="Thinnest spot" hint="Lowest average over 3 × 3 cells, so one noisy reading doesn't decide it" value={m.thinnest === null ? "—" : formatThickness(m.thinnest)} />
                <Row label="Thickest spot" value={m.thickest === null ? "—" : formatThickness(m.thickest)} />
                <Row label="Target" value={`${formatThickness(target)} ± ${formatThickness(selected.layer.tolerance_m)}`} />
              </dl>
            )}
            <p className={`panel-note q-accuracy ${reliability}`}>
              {reliability === "poor"
                ? `A ${formatThickness(target)} lift is about the size of the drone's error (±2–5 cm a flight, and thickness takes two flights). Treat these thicknesses as a rough guide and check with cores or the paving tickets.`
                : reliability === "fair"
                  ? `Each flight is ±${formatThickness(DRONE_ACCURACY_M[0])}–${formatThickness(DRONE_ACCURACY_M[1])}, so a single spot is good to about ±${formatThickness(0.03)}–${formatThickness(0.07)} on a ${formatThickness(target)} layer. Averages over the area are much better.`
                  : `±${formatThickness(0.03)}–${formatThickness(0.07)} at a single spot (each flight is ±2–5 cm); averages over the area are much better. A flight that came back high or low shifts everything — check Control & accuracy.`}
            </p>
            <div className="q-actions">
              <button className="secondary-btn" onClick={() => setEditing((e) => !e)}>
                {editing ? "Done" : "Edit layer"}
              </button>
              <button className="secondary-btn" onClick={() => setDrawing("redraw")}>
                Redraw outline
              </button>
              <button className="text-btn danger" onClick={() => setDeleting(true)}>
                <Icon name="trash" size={13} /> Delete
              </button>
            </div>
            {editing && <LayerForm layer={selected.layer} scans={site.scans} onChange={(p) => update(selected.layer.id, p)} />}
          </>
        )}
      </section>

      {m && selected && patches.length > 0 && (
        <section className="site-card wide">
          <h3>
            Thin patches <span className="site-card-note">under {formatThickness(minOk)}, largest first</span>
          </h3>
          <div className="zone-table-wrap">
            <table className="zone-table">
              <thead>
                <tr>
                  <th>Where</th>
                  <th className="num">Area</th>
                  <th className="num">Thinnest</th>
                  <th className="num">Short by</th>
                </tr>
              </thead>
              <tbody>
                {patches.slice(0, 12).map((p, k) => (
                  <tr key={k}>
                    <td>{patchWhere(p, g)}</td>
                    <td className="num fig">{q(formatArea(p.area))}</td>
                    <td className="num fig">{formatThickness(p.thinnest)}</td>
                    <td className="num fig late">{formatThickness(Math.max(0, minOk - p.thinnest))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(patches.length > 12 || specks > 0) && (
            <p className="panel-note">
              {patches.length > 12 && `…and ${patches.length - 12} smaller patches. `}
              {specks > 0 && `${specks} single cell${specks === 1 ? "" : "s"} also read${specks === 1 ? "s" : ""} thin — as likely scan noise as a low spot; counted in the thin area.`}
            </p>
          )}
        </section>
      )}

      <ConfirmDialog open={deleting} title={`Delete “${selected?.layer.name ?? ""}”?`} confirmLabel="Delete layer" onConfirm={remove} onCancel={() => setDeleting(false)}>
        <p>The layer's outline and settings are removed. The flights aren't affected.</p>
      </ConfirmDialog>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric-row" title={hint}>
      <dt>{label}</dt>
      <dd className="fig">{value}</dd>
    </div>
  );
}

/** A patch's location in words: its centre as distances east / north of the plan's south-west corner. */
function patchWhere(p: ThinPatch, g: { x0: number; y0: number; cell: number }): string {
  const [c0, r0, c1, r1] = p.bbox;
  const e = g.x0 + ((c0 + c1 + 1) / 2) * g.cell, n = g.y0 + ((r0 + r1 + 1) / 2) * g.cell;
  return `E ${formatCoordinate(e)}, N ${formatCoordinate(n)}`;
}

function LayerVerdict({ r, dates, scan }: { r: LayerResult; dates: string[]; scan: number }) {
  const { layer, base, measure: m } = r;
  if (base === null)
    return (
      <div className="notice-card warn">
        <p>
          {r.autoBase
            ? "No flight shows this layer going down yet. If it has been placed, choose the flight it sits on in Edit layer."
            : "The flight this layer was measured from is no longer in the site. Choose another in Edit layer."}
        </p>
      </div>
    );
  if (!m)
    return (
      <div className="notice-card">
        <p>
          Measured from the <strong>{formatDate(dates[base])}</strong> flight{r.autoBase ? " (the last one before it appears)" : ""}. Pick a later flight
          in the timeline to see how thick it is.
        </p>
      </div>
    );
  const minOk = layer.target_thickness_m - layer.tolerance_m;
  const from = `${formatDate(dates[base], true)} → ${formatDate(dates[scan], true)}`;
  if (m.placedArea === 0)
    return (
      <div className="notice-card">
        <p>Nothing placed inside the outline yet ({from}).</p>
      </div>
    );
  if (m.thinArea > 0)
    return (
      <div className="notice-card warn q-bad">
        <p>
          <strong>
            {q(formatArea(m.thinArea))} of {layer.name.toLowerCase()} is under {formatThickness(minOk)}
            {m.thinnest !== null ? ` — ${formatThickness(m.thinnest)} at the thinnest` : ""}.
          </strong>{" "}
          Measured {from}.
        </p>
      </div>
    );
  return (
    <div className="notice-card ok">
      <p>
        <strong>Thick enough everywhere it's placed</strong> — no spot under {formatThickness(minOk)}. Measured {from}.
      </p>
    </div>
  );
}

function LayerForm({ layer, scans, onChange }: { layer: Layer; scans: { project_id: string; date: string }[]; onChange: (p: Partial<Layer>) => void }) {
  const preset = layerPreset(layer.material);
  const [custom, setCustom] = useState(!preset && layer.material !== "");
  return (
    <div className="payapp-form q-form">
      <label className="js-field">
        <span>Name</span>
        <input value={layer.name} maxLength={60} onChange={(e) => e.target.value.trim() && onChange({ name: e.target.value })} />
      </label>
      <label className="js-field">
        <span>Material</span>
        <select
          value={custom ? "other" : preset?.id ?? "other"}
          onChange={(e) => {
            const p = LAYER_MATERIALS.find((x) => x.id === e.target.value);
            setCustom(!p);
            if (p) onChange({ material: p.label, density_t_m3: p.density });
          }}
        >
          {LAYER_MATERIALS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.density ? ` (typ. ${formatDensity(p.density)})` : ""}
            </option>
          ))}
          <option value="other">Other…</option>
        </select>
      </label>
      {custom && (
        <label className="js-field">
          <span>Material name</span>
          <input value={layer.material} maxLength={60} onChange={(e) => onChange({ material: e.target.value })} />
        </label>
      )}
      <label className="js-field">
        <span>Target thickness</span>
        <QuantityInput kind="thickness" value={layer.target_thickness_m} min={0.005} max={5} onChange={(v) => onChange({ target_thickness_m: v })} />
      </label>
      <label className="js-field">
        <span title="Thinner than target minus this is flagged">Tolerance (±)</span>
        <QuantityInput kind="thickness" value={layer.tolerance_m} min={0} max={1} onChange={(v) => onChange({ tolerance_m: v })} />
      </label>
      <label className="js-field">
        <span>Weight per volume</span>
        <QuantityInput
          kind="density"
          value={layer.density_t_m3}
          min={0.1}
          max={10}
          disabled={layer.density_t_m3 === null}
          onChange={(v) => onChange({ density_t_m3: v })}
        />
        <label className="check-row q-check">
          <input
            type="checkbox"
            checked={layer.density_t_m3 !== null}
            onChange={(e) => onChange({ density_t_m3: e.target.checked ? preset?.density ?? 2.0 : null })}
          />
          Work out tonnage
        </label>
      </label>
      <label className="js-field">
        <span>Sits on the flight of</span>
        <select value={layer.base_scan ?? ""} onChange={(e) => onChange({ base_scan: e.target.value || null })}>
          <option value="">Automatic — the flight before it appears</option>
          {scans.map((s) => (
            <option key={s.project_id} value={s.project_id}>
              {formatDate(s.date)}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint q-form-note">
        Densities are typical values — use the number on the supplier's ticket when you have it.
      </p>
    </div>
  );
}
