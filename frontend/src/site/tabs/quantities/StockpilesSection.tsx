import { useMemo, useState } from "react";
import { useElementWidth } from "../../../charts/useElementWidth";
import { ConfirmDialog } from "../../../layout/ConfirmDialog";
import { Icon } from "../../../layout/icons";
import { formatDensity, formatLength, formatTonnage, formatVolume, niceStep, quantityText, toDisplay, unitOf } from "../../../lib/units";
import { formatDate } from "../../dates";
import { paintLayer, PlanView, type ReadoutRow } from "../../PlanView";
import { confidenceWord, PILE_MATERIALS } from "../../quantities";
import { FILL } from "../../siteColors";
import { ZONE_PALETTE } from "../../types";
import type { SiteTabProps } from "../types";
import { cellsOfShape, type PileResult } from "./model";

const q = (x: { value: string; unit: string }) => quantityText(x);

interface Props extends SiteTabProps {
  piles: PileResult[];
  loading: boolean;
  error: string | null;
}

/** Stockpile inventory: volume per pile, what it's made of, weight, change since last flight. */
export function StockpilesSection(props: Props) {
  const { site, surfaces, scan, state, piles, loading, error } = props;
  const [selectedId, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const g = surfaces;

  // height above the first flight inside every stockpile zone
  const { paint, heights, top } = useMemo(() => {
    const h = new Float64Array(g.nx * g.ny).fill(NaN);
    let top = 0.5;
    for (const p of piles) {
      for (const i of cellsOfShape(props, p.zone.polygon)) {
        const d = g.scans[scan][i] - g.scans[0][i];
        if (Number.isFinite(d)) {
          h[i] = d;
          top = Math.max(top, d);
        }
      }
    }
    const paint = paintLayer(g.nx * g.ny, (i) => (h[i] > site.change_threshold_m ? [...FILL, 0.3 + 0.6 * Math.min(1, h[i] / top)] : null));
    return { paint, heights: h, top };
  }, [piles, g, scan, site.change_threshold_m]);

  const pileAt = (i: number) => piles.find((p) => cellsOfShape(props, p.zone.polygon).includes(i)) ?? null;
  const readout = (i: number): ReadoutRow[] => {
    if (!Number.isFinite(heights[i])) return [];
    return [{ label: "Above original ground", value: formatLength(heights[i]), tone: heights[i] > site.change_threshold_m ? "fill" : undefined }];
  };

  const drawn = (polygon: [number, number][]) => {
    setDrawing(false);
    const id = `pile${Date.now().toString(36)}`;
    state.update((s) => ({
      ...s,
      zones: [
        ...s.zones,
        { id, name: `Stockpile ${s.zones.filter((z) => z.kind === "stockpile").length + 1}`, kind: "stockpile", color: ZONE_PALETTE[s.zones.length % ZONE_PALETTE.length], polygon, start: null, finish: null },
      ],
    }));
    setSelected(id);
  };
  const deletingPile = piles.find((p) => p.zone.id === deleting) ?? null;
  const remove = () => {
    if (!deletingPile) return;
    const id = deletingPile.zone.id;
    state.update((s) => ({
      ...s,
      zones: s.zones.filter((z) => z.id !== id),
      pay_apps: s.pay_apps.map((p) => (p.zone_id === id ? { ...p, zone_id: null } : p)),
    }));
    setDeleting(null);
  };

  return (
    <div className="site-grid">
      <section className="site-card site-map-card">
        <div className="site-card-head">
          <strong className="q-head-name">Height above the original ground</strong>
          <div className="site-card-tools">
            <button className={drawing ? "primary-btn compact" : "secondary-btn"} onClick={() => setDrawing((d) => !d)}>
              <Icon name="plus" size={14} /> {drawing ? "Drawing…" : "Add stockpile"}
            </button>
          </div>
        </div>
        <PlanView
          grid={g}
          relief={g.scans[scan]}
          layer={paint}
          shapes={piles.map((p) => ({ id: p.zone.id, points: p.zone.polygon, color: p.zone.color, label: p.zone.name, selected: p.zone.id === selectedId }))}
          readout={readout}
          title={(i) => pileAt(i)?.zone.name ?? null}
          onPickShape={(id) => setSelected(id)}
          draw={drawing ? { kind: "polygon", hint: "Click around the pile, leaving a little ground all round it", onDone: drawn, onCancel: () => setDrawing(false) } : null}
          ariaLabel="Stockpile heights, north up"
        />
        <div className="site-legend">
          <span>
            <i className="sw fill" /> material piled on the first flight's ground (up to {formatLength(top)})
          </span>
          <span className="site-legend-note">changes under {formatLength(site.change_threshold_m)} ignored</span>
        </div>
      </section>

      <section className="site-card">
        <h3>
          Stockpiles <span className="site-card-note">at {formatDate(g.dates[scan])}</span>
        </h3>
        {piles.length === 0 ? (
          <p className="panel-note">
            No stockpiles yet. Click <strong>Add stockpile</strong> and draw around a pile, leaving a little ground all round it. Its volume is
            measured above the ground of the first flight, so draw piles that weren't there on day one.
          </p>
        ) : (
          <>
            {error && <div className="notice-card warn"><p>Couldn't read the flight's colours to tell the materials apart: {error}</p></div>}
            <div className="zone-table-wrap">
              <table className="zone-table">
                <thead>
                  <tr>
                    <th>Pile</th>
                    <th>Material</th>
                    <th className="num">Volume</th>
                    <th className="num">Weight</th>
                    <th className="num">Since last</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {piles.map((p) => (
                    <tr key={p.zone.id} data-selected={p.zone.id === selectedId || undefined} onClick={() => setSelected(p.zone.id)}>
                      <td>
                        <span className="zone-name">
                          <i style={{ background: p.zone.color }} />
                          {p.zone.name}
                        </span>
                      </td>
                      <td>
                        <MaterialPicker pile={p} loading={loading} dates={g.dates} onChange={(material) => state.updateZone(p.zone.id, { material })} />
                      </td>
                      <td className="num fig">{q(formatVolume(p.volume))}</td>
                      <td className="num fig" title={p.material ? `Volume × ${formatDensity(p.material.density)} (typical loose ${p.material.label.toLowerCase()})` : undefined}>
                        {p.tonnes === null ? "—" : q(formatTonnage(p.tonnes))}
                      </td>
                      <td className={`num fig ${p.change && p.change < 0 ? "q-down" : p.change && p.change > 0 ? "q-up" : ""}`}>
                        {p.change === null ? "—" : `${p.change > 0 ? "+" : ""}${q(formatVolume(p.change))}`}
                      </td>
                      <td>
                        <button className="zone-delete" title={`Delete ${p.zone.name}`} onClick={(e) => (e.stopPropagation(), setDeleting(p.zone.id))}>
                          <Icon name="trash" size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel-note q-note">
              Material is read from the pile's colour and laser brightness on the flight: topsoil is dark and dull, stone is grey and bright, soil
              is mid brown. Weights use typical loose densities — {PILE_MATERIALS.map((m) => `${m.label.toLowerCase()} ${formatDensity(m.density)}`).join(", ")}; trust a
              weighbridge ticket over them. Volumes are ±2–5 cm over the pile's footprint.
            </p>
          </>
        )}
      </section>

      {piles.length > 0 && (
        <section className="site-card wide">
          <h3>Stockpiles over time</h3>
          <PileChart piles={piles} dates={g.dates} scan={scan} selected={selectedId} onSelect={setSelected} />
        </section>
      )}

      <ConfirmDialog open={deletingPile !== null} title={`Delete “${deletingPile?.zone.name ?? ""}”?`} confirmLabel="Delete stockpile" onConfirm={remove} onCancel={() => setDeleting(null)}>
        <p>The pile's outline and material are removed (it's a zone, so it leaves the Progress tab too). The flights aren't affected.</p>
      </ConfirmDialog>
    </div>
  );
}

function MaterialPicker({ pile, loading, dates, onChange }: { pile: PileResult; loading: boolean; dates: string[]; onChange: (m: string | null) => void }) {
  const g = pile.guess;
  const guessed = PILE_MATERIALS.find((m) => m.id === g?.material);
  const auto = !g
    ? loading
      ? "Looking at the flight…"
      : "Guess: —"
    : guessed
      ? `Looks like ${guessed.label.toLowerCase()} (${confidenceWord(g.confidence)} confidence)`
      : g.sampled === 0
        ? "Guess: no pile to look at"
        : !g.usedColour && !g.usedIntensity
          ? "Guess: no colour in this flight"
          : "Guess: can't tell";
  const title = g
    ? guessed
      ? `${Math.round(g.confidence * 100)} % of the ${g.sampled} cells sampled on the ${formatDate(dates[pile.guessFlight ?? 0], true)} flight look like ${guessed.label.toLowerCase()} (${guessed.look}). Choose the material to override.`
      : "Choose the material: the flight has no colour or intensity to judge it by, or the pile is too low."
    : undefined;
  return (
    <select
      className="q-select q-material"
      value={pile.chosen?.id ?? ""}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={`Material of ${pile.zone.name}`}
    >
      <option value="">{auto}</option>
      {PILE_MATERIALS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

const H = 220;
const PAD = { left: 52, right: 14, top: 12, bottom: 26 };

/** Volume of each pile at every flight (one line per pile, in its zone colour), with a hover readout. */
function PileChart({ piles, dates, scan, selected, onSelect }: { piles: PileResult[]; dates: string[]; scan: number; selected: string | null; onSelect: (id: string) => void }) {
  const [ref, W] = useElementWidth<HTMLDivElement>(600);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...piles.flatMap((p) => p.volumes));
  const unit = unitOf("volume");
  const maxD = toDisplay(max, "volume");
  const step = niceStep(maxD / 4);
  const ticks = Array.from({ length: Math.floor(maxD / step) + 1 }, (_, k) => k * step);
  const top = Math.max(maxD, ticks[ticks.length - 1]);
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const x = (k: number) => PAD.left + (dates.length > 1 ? (k / (dates.length - 1)) * plotW : plotW / 2);
  const y = (displayV: number) => PAD.top + (1 - displayV / top) * plotH;
  const faded = (id: string) => selected !== null && selected !== id;

  return (
    <div ref={ref} className="chart-box site-chart q-chart">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label="Stockpile volume at each flight"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const k = Math.round(((e.clientX - r.left - PAD.left) / plotW) * (dates.length - 1));
          setHover(k >= 0 && k < dates.length ? k : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-axis" : "site-chart-grid"} />
            <text x={PAD.left - 6} y={y(t) + 4} className="chart-label" textAnchor="end">
              {t.toLocaleString("en-GB")}
            </text>
          </g>
        ))}
        <text x={4} y={PAD.top + 4} className="chart-label">
          {unit}
        </text>
        {dates.map((d, k) => (
          <text key={d} x={x(k)} y={H - 8} className="chart-label" textAnchor="middle" fontWeight={k === scan ? 600 : undefined}>
            {formatDate(d, true)}
          </text>
        ))}
        <line x1={x(scan)} x2={x(scan)} y1={PAD.top} y2={y(0)} className="site-chart-today" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} className="q-crosshair" />}
        {piles.map((p) => (
          <g key={p.zone.id} opacity={faded(p.zone.id) ? 0.3 : 1} onClick={() => onSelect(p.zone.id)} style={{ cursor: "pointer" }}>
            <polyline
              fill="none"
              stroke={p.zone.color}
              strokeWidth={2}
              points={p.volumes.map((v, k) => `${x(k)},${y(toDisplay(v, "volume"))}`).join(" ")}
            />
            {p.volumes.map((v, k) => (
              <circle key={k} cx={x(k)} cy={y(toDisplay(v, "volume"))} r={k === scan || k === hover ? 4 : 2.5} fill={p.zone.color} className="q-dot" />
            ))}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="q-tip" style={{ left: Math.min(x(hover) + 10, W - 190) }}>
          <strong>{formatDate(dates[hover])}</strong>
          {piles.map((p) => (
            <div key={p.zone.id}>
              <i style={{ background: p.zone.color }} />
              <span>{p.zone.name}</span>
              <span className="fig">
                {q(formatVolume(p.volumes[hover]))}
                {p.material ? ` · ${q(formatTonnage(p.volumes[hover] * p.material.density))}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="site-legend">
        {piles.map((p) => (
          <span key={p.zone.id}>
            <i className="sw" style={{ background: p.zone.color }} /> {p.zone.name}
            {p.material ? ` (${p.material.label.toLowerCase()})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
