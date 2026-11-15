import { useMemo, useState } from "react";
import { useElementWidth } from "../../../charts/useElementWidth";
import { QuantityInput } from "../../../components/QuantityInput";
import { ConfirmDialog } from "../../../layout/ConfirmDialog";
import { Icon } from "../../../layout/icons";
import { elevationTicks, formatArea, formatElevation, formatLength, formatVolume, niceStep, quantityText, toDisplay, unitOf } from "../../../lib/units";
import { formatDate } from "../../dates";
import { paintLayer, PlanView, type ReadoutRow } from "../../PlanView";
import { FILL } from "../../siteColors";
import type { Pond } from "../../types";
import type { SiteTabProps } from "../types";
import { cellsOfShape, suggestOutlet, type PondResult } from "./model";

const q = (x: { value: string; unit: string }) => quantityText(x);
const UNSEEN: [number, number, number] = [226, 172, 52]; // amber: no ground return here

/** Detention pond storage: the stage–storage curve as built vs designed, and a verdict. */
export function PondSection(props: SiteTabProps & { results: PondResult[] }) {
  const { surfaces, scan, state, results } = props;
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const r = results.find((x) => x.pond.zone_id === pickedZone) ?? results[0] ?? null;
  const g = surfaces;

  const updatePond = (zoneId: string, patch: Partial<Pond>) =>
    state.update((s) => ({ ...s, ponds: (s.ponds ?? []).map((p) => (p.zone_id === zoneId ? { ...p, ...patch } : p)) }));

  const { paint, depth } = useMemo(() => {
    const depth = new Float64Array(g.nx * g.ny).fill(NaN);
    if (!r?.zone) return { paint: null, depth };
    const z = g.scans[scan];
    const outlet = r.pond.spill_elevation_m;
    const cells = cellsOfShape(props, r.zone.polygon);
    const unseen = new Set<number>();
    let deepest = 0.3;
    for (const i of cells) {
      if (!Number.isFinite(z[i])) unseen.add(i);
      else {
        depth[i] = outlet - z[i];
        deepest = Math.max(deepest, depth[i]);
      }
    }
    const paint = paintLayer(g.nx * g.ny, (i) =>
      unseen.has(i) ? [...UNSEEN, 0.85] : depth[i] > 0 ? [...FILL, 0.25 + 0.65 * Math.min(1, depth[i] / deepest)] : null
    );
    return { paint, depth };
  }, [r, g, scan]);

  const readout = (i: number): ReadoutRow[] => {
    if (!r?.zone || !cellsOfShape(props, r.zone.polygon).includes(i)) return [];
    if (!Number.isFinite(g.scans[scan][i])) return [{ label: "Ground", value: "not seen (water?)" }];
    const d = depth[i];
    return [
      { label: "Ground", value: formatElevation(g.scans[scan][i]) },
      d > 0 ? { label: "Water depth at outlet", value: formatLength(d), tone: "fill" } : { label: "Above the outlet by", value: formatLength(-d) },
    ];
  };

  if (!r || adding)
    return (
      <PondSetup
        {...props}
        taken={results.map((x) => x.pond.zone_id)}
        onCancel={results.length ? () => setAdding(false) : null}
        onDone={(zoneId) => {
          setAdding(false);
          setPickedZone(zoneId);
        }}
      />
    );

  const remove = () => {
    state.update((s) => ({ ...s, ponds: (s.ponds ?? []).filter((p) => p.zone_id !== r.pond.zone_id) }));
    setDeleting(false);
    setPickedZone(null);
  };
  const name = r.zone?.name ?? "Pond";

  return (
    <div className="site-grid">
      <section className="site-card wide">
        <PondVerdict r={r} date={g.dates[scan]} />
      </section>

      <section className="site-card site-map-card">
        <div className="site-card-head">
          {results.length > 1 ? (
            <select className="q-select" value={r.pond.zone_id} onChange={(e) => setPickedZone(e.target.value)} aria-label="Pond">
              {results.map((x) => (
                <option key={x.pond.zone_id} value={x.pond.zone_id}>
                  {x.zone?.name ?? "(zone deleted)"}
                </option>
              ))}
            </select>
          ) : (
            <strong className="q-head-name">Water depth when full to the outlet</strong>
          )}
          <div className="site-card-tools">
            <button className="secondary-btn" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} /> Add pond
            </button>
          </div>
        </div>
        {r.zone ? (
          <PlanView
            grid={g}
            relief={g.scans[scan]}
            layer={paint}
            shapes={[{ id: r.zone.id, points: r.zone.polygon, color: r.zone.color, label: name, fill: false }]}
            readout={readout}
            title={() => name}
            ariaLabel="Pond depth below the outlet, north up"
          />
        ) : (
          <div className="notice-card warn">
            <p>This pond's zone was deleted. Delete the pond and set it up again on another zone.</p>
          </div>
        )}
        <div className="site-legend">
          <span>
            <i className="sw fill" /> below the outlet ({formatElevation(r.pond.spill_elevation_m)}): holds water
          </span>
          <span>
            <i className="sw q-thick" /> no ground seen (usually standing water)
          </span>
        </div>
      </section>

      <section className="site-card">
        <h3>
          {name} <span className="site-card-note">at {formatDate(g.dates[scan])}</span>
        </h3>
        {r.built && (
          <dl className="metric-list">
            <Row label="Holds now, below the outlet" value={q(formatVolume(r.built.storage))} />
            {r.design && <Row label="Design holds" value={q(formatVolume(r.design.storage))} />}
            {r.pond.required_storage_m3 != null && <Row label="Required" value={q(formatVolume(r.pond.required_storage_m3))} />}
            {r.stillToDig != null && <Row label="Still to dig below the outlet" value={q(formatVolume(r.stillToDig))} />}
            <Row label="Outlet (spill) elevation" value={formatElevation(r.pond.spill_elevation_m)} />
            {r.built.floor !== null && <Row label="Lowest ground seen" value={formatElevation(r.built.floor)} />}
            {r.design?.floor != null && <Row label="Design floor" value={formatElevation(r.design.floor)} />}
            <Row label="Floor not seen" hint="No laser return: standing water, a machine or a gap" value={q(formatArea(r.built.unseenArea))} />
          </dl>
        )}
        <div className="q-actions">
          <button className="secondary-btn" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit pond"}
          </button>
          <button className="text-btn danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" size={13} /> Delete
          </button>
        </div>
        {editing && (
          <div className="payapp-form q-form">
            <label className="js-field">
              <span>Outlet (spill) elevation</span>
              <QuantityInput kind="elevation" value={r.pond.spill_elevation_m} min={-1000} max={10000} onChange={(v) => updatePond(r.pond.zone_id, { spill_elevation_m: v })} />
            </label>
            <RequiredInput value={r.pond.required_storage_m3} onChange={(v) => updatePond(r.pond.zone_id, { required_storage_m3: v })} />
          </div>
        )}
      </section>

      {r.built && (
        <section className="site-card wide">
          <h3>
            Storage at each water level <span className="site-card-note">stage–storage curve</span>
          </h3>
          <StageChart r={r} />
        </section>
      )}

      <ConfirmDialog open={deleting} title={`Stop checking “${name}”?`} confirmLabel="Delete pond" onConfirm={remove} onCancel={() => setDeleting(false)}>
        <p>The pond's outlet and required volume are removed. Its zone and the flights aren't affected.</p>
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

function RequiredInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="js-field">
      <span>Required storage (from the drainage report)</span>
      <QuantityInput kind="volume" value={value} min={0} max={1e8} disabled={value === null} onChange={onChange} />
      <label className="check-row q-check">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? 0 : null)} />
        Check against a required volume
      </label>
    </label>
  );
}

function PondVerdict({ r, date }: { r: PondResult; date: string }) {
  const b = r.built;
  if (!b) return null;
  const required = r.pond.required_storage_m3;
  const unseen =
    b.unseenArea > 0 ? (
      <p>
        {q(formatArea(b.unseenArea))} of the pond wasn't seen on the {formatDate(date, true)} flight — no laser return, usually standing water.
        We only count ground we saw, so it holds at least {q(formatVolume(b.storage))}; if that floor is as low as the lowest ground seen, up to{" "}
        {q(formatVolume(b.storage + b.unseenUpTo))}.
      </p>
    ) : null;
  let headline: string, tone: "ok" | "warn" | "bad";
  if (r.pctOfDesign !== null && r.design) {
    const pct = r.pctOfDesign;
    tone = pct >= 98 ? "ok" : pct >= 75 ? "warn" : "bad";
    headline =
      pct >= 98
        ? `Holds ${pct.toFixed(0)}% of the design volume — dug to design below the outlet.`
        : `Holds ${pct.toFixed(0)}% of the design volume — ${q(formatVolume(r.stillToDig ?? 0))} still to dig below the outlet.`;
  } else {
    tone = "warn";
    headline = `Holds ${q(formatVolume(b.storage))} below the outlet. Add a design surface to compare with what was designed.`;
  }
  let req: string | null = null;
  if (required != null && required > 0) {
    req =
      b.storage >= required
        ? `Meets the required ${q(formatVolume(required))}.`
        : `Short of the required ${q(formatVolume(required))} by ${q(formatVolume(required - b.storage))}.`;
    if (r.design && r.design.storage < required) req += ` The design itself only holds ${q(formatVolume(r.design.storage))} — check the outlet elevation or the design.`;
    if (b.storage < required && tone === "ok") tone = "warn";
  }
  return (
    <div className={`q-verdict ${tone}`}>
      <strong>{headline}</strong>
      {req && <p>{req}</p>}
      {unseen}
    </div>
  );
}

function PondSetup(props: SiteTabProps & { taken: string[]; onCancel: (() => void) | null; onDone: (zoneId: string) => void }) {
  const { site, state, taken, onCancel, onDone } = props;
  const zones = site.zones.filter((z) => z.kind === "grading" && !taken.includes(z.id));
  const guess = zones.find((z) => /pond|basin|detention|retention/i.test(z.name)) ?? zones[0] ?? null;
  const [zoneId, setZoneId] = useState<string | null>(guess?.id ?? null);
  const zone = zones.find((z) => z.id === zoneId) ?? null;
  const suggested = useMemo(() => (zone ? suggestOutlet(props, zone) : null), [zone]);
  const [outlet, setOutlet] = useState<number | null>(null);
  const [required, setRequired] = useState<number | null>(null);
  const value = outlet ?? suggested;
  return (
    <div className="site-grid">
      <section className="site-card wide">
        <h3>Check a detention pond</h3>
        {zones.length === 0 ? (
          <p className="panel-note">
            {site.zones.length === 0 ? "Draw the pond as a zone on the Progress tab first" : "Every grading zone already has a pond — draw another zone on the Progress tab"}, then
            come back to say where its outlet is.
          </p>
        ) : (
          <>
            <p className="panel-note">
              Pick the zone that outlines the pond and enter the outlet (spill) elevation from the plans. The tab works out how much water the
              pond holds below it on each flight and on the finished grade.
            </p>
            <div className="payapp-form q-form">
              <label className="js-field">
                <span>Pond zone</span>
                <select value={zoneId ?? ""} onChange={(e) => (setZoneId(e.target.value), setOutlet(null))}>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="js-field">
                <span>Outlet (spill) elevation</span>
                <QuantityInput kind="elevation" value={value} min={-1000} max={10000} onChange={setOutlet} />
                {suggested !== null && outlet === null && <span className="field-hint">Starts at the lowest point on the zone's edge in the design — check it against the plans.</span>}
              </label>
              <RequiredInput value={required} onChange={setRequired} />
              <div className="payapp-actions">
                {onCancel && (
                  <button className="secondary-btn" onClick={onCancel}>
                    Cancel
                  </button>
                )}
                <button
                  className="primary-btn"
                  disabled={!zone || value === null}
                  onClick={() => {
                    if (!zone || value === null) return;
                    state.update((s) => ({ ...s, ponds: [...(s.ponds ?? []), { zone_id: zone.id, spill_elevation_m: value, required_storage_m3: required }] }));
                    onDone(zone.id);
                  }}
                >
                  Check this pond
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const H = 260;
const PAD = { left: 78, right: 16, top: 14, bottom: 30 };

/** Volume held below each elevation: as built (solid) vs design (dashed), outlet and required volume marked. */
function StageChart({ r }: { r: PondResult }) {
  const [ref, W] = useElementWidth<HTMLDivElement>(600);
  const [hover, setHover] = useState<number | null>(null); // index into the curve
  const b = r.built!;
  const d = r.design;
  const req = r.pond.required_storage_m3 ?? null;
  const curves = [b.curve, ...(d ? [d.curve] : [])];
  const levels = (d?.curve.length ?? 0) > b.curve.length ? d!.curve : b.curve;
  if (levels.length < 2) return <p className="panel-note">The ground in the zone is all above the outlet — nothing to store yet.</p>;
  const lo = levels[0].elevation, hi = r.pond.spill_elevation_m;
  const vMax = Math.max(1, ...curves.flatMap((c) => c.map((p) => p.volume)), req ?? 0);
  const vMaxD = toDisplay(vMax, "volume");
  const step = niceStep(vMaxD / 4);
  const vTicks = Array.from({ length: Math.ceil(vMaxD / step) + 1 }, (_, k) => k * step);
  const vTop = vTicks[vTicks.length - 1];
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const x = (m3: number) => PAD.left + (toDisplay(m3, "volume") / vTop) * plotW;
  const y = (z: number) => PAD.top + (1 - (z - lo) / Math.max(hi - lo, 1e-6)) * plotH;
  const path = (c: { elevation: number; volume: number }[]) => c.map((p) => `${x(p.volume)},${y(p.elevation)}`).join(" ");
  const at = hover !== null ? levels[hover] : null;
  const vol = (c: { elevation: number; volume: number }[], z: number) => c.find((p) => Math.abs(p.elevation - z) < 1e-9)?.volume ?? null;

  return (
    <div ref={ref} className="chart-box site-chart q-chart">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label="Water held below each elevation, as built and as designed"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const z = lo + (1 - (e.clientY - rect.top - PAD.top) / plotH) * (hi - lo);
          let best = 0;
          levels.forEach((p, k) => Math.abs(p.elevation - z) < Math.abs(levels[best].elevation - z) && (best = k));
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {elevationTicks(lo, hi, 4).map((t) => (
          <g key={t.label}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t.metres)} y2={y(t.metres)} className="site-chart-grid" />
            <text x={PAD.left - 6} y={y(t.metres) + 4} className="chart-label" textAnchor="end">
              {t.label}
            </text>
          </g>
        ))}
        {vTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left + (t / vTop) * plotW} x2={PAD.left + (t / vTop) * plotW} y1={PAD.top} y2={H - PAD.bottom} className={t === 0 ? "chart-axis" : "site-chart-grid"} />
            <text x={PAD.left + (t / vTop) * plotW} y={H - 10} className="chart-label" textAnchor="middle">
              {t.toLocaleString("en-GB")}
            </text>
          </g>
        ))}
        <text x={W - PAD.right} y={H - 10} className="chart-label" textAnchor="end" dy={-12}>
          {unitOf("volume")} held
        </text>
        <line x1={PAD.left} x2={W - PAD.right} y1={y(hi)} y2={y(hi)} className="q-outlet" />
        <text x={W - PAD.right} y={y(hi) - 4} className="chart-label" textAnchor="end">
          outlet
        </text>
        {req !== null && req > 0 && (
          <>
            <line x1={x(req)} x2={x(req)} y1={PAD.top} y2={H - PAD.bottom} className="q-required" />
            <text x={x(req) + 4} y={PAD.top + 22} className="chart-label">
              required
            </text>
          </>
        )}
        {d && <polyline points={path(d.curve)} className="q-curve design" />}
        <polyline points={path(b.curve)} className="q-curve built" />
        {at && <line x1={PAD.left} x2={W - PAD.right} y1={y(at.elevation)} y2={y(at.elevation)} className="q-crosshair" />}
        {at && vol(b.curve, at.elevation) !== null && <circle cx={x(vol(b.curve, at.elevation)!)} cy={y(at.elevation)} r={4} className="q-dot built" />}
        {at && d && vol(d.curve, at.elevation) !== null && <circle cx={x(vol(d.curve, at.elevation)!)} cy={y(at.elevation)} r={4} className="q-dot design" />}
      </svg>
      {at && (
        <div className="q-tip" style={{ left: PAD.left + 8, top: Math.max(0, y(at.elevation) - 70) }}>
          <strong>Water at {formatElevation(at.elevation)}</strong>
          <div>
            <i className="q-key built" />
            <span>As built</span>
            <span className="fig">{vol(b.curve, at.elevation) === null ? "—" : q(formatVolume(vol(b.curve, at.elevation)!))}</span>
          </div>
          {d && (
            <div>
              <i className="q-key design" />
              <span>Design</span>
              <span className="fig">{vol(d.curve, at.elevation) === null ? "—" : q(formatVolume(vol(d.curve, at.elevation)!))}</span>
            </div>
          )}
        </div>
      )}
      <div className="site-legend">
        <span>
          <i className="q-key built" /> as built (this flight)
        </span>
        {d && (
          <span>
            <i className="q-key design" /> design (finished grade)
          </span>
        )}
        <span className="site-legend-note">only ground that was seen counts</span>
      </div>
    </div>
  );
}
