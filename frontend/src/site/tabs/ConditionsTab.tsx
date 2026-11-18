// Site conditions: everything a flight shows besides earthworks — what the site
// looks like, what's standing on it, what changed, and whether anything is
// outside where it should be. Numbers come from the engine (conditions.py);
// the site's own outlines are applied here (conditions.ts).
import { useMemo, useState } from "react";
import { ConfirmDialog } from "../../layout/ConfirmDialog";
import { Icon } from "../../layout/icons";
import { formatArea, formatDistance, formatLength, formatSmall, formatVolume, quantityText } from "../../lib/units";
import {
  ACRE_M2,
  LAYER_COLOURS,
  MARK,
  cellMask,
  conditionsLayer,
  needsStormwaterPermit,
  outsideLimits,
  pondSediment,
  rillSeverity,
  stormFindings,
  swatch,
  zoneAt,
  type Conditions,
  type LayerKind,
  type StormFinding,
} from "../conditions";
import { peekConditions, useConditions } from "../conditionsApi";
import { formatDate } from "../dates";
import { PlanView, type PlanMarker, type PlanShape, type ReadoutRow } from "../PlanView";
import { zoneCells } from "../progress";
import { useFlightRasters } from "../rasters";
import type { SiteTabProps } from "./types";
import "./conditions.css";

const LAYERS: ReadonlyArray<[LayerKind, string, string]> = [
  ["photo", "Photo", "The flight's top-down photo"],
  ["intensity", "Intensity", "How strongly the ground reflects the laser: shows materials"],
  ["vegetation", "Vegetation", "Trees and brush, by height"],
  ["objects", "Machines", "Machines and anything else standing on the ground"],
  ["disturbed", "Disturbed", "Ground worked since the first flight, and the limits of disturbance"],
  ["storm", "Storm check", "Erosion, possible standing water and pond silt since the flight before"],
  ["coverage", "Coverage", "Where the flight saw too little ground to measure it well"],
];

const area = (m2: number) => quantityText(formatArea(m2));
const acres = (m2: number) => (m2 / ACRE_M2).toFixed(2);

export function ConditionsTab(props: SiteTabProps) {
  const { siteId, site, surfaces, state, scan, onScan, reloadKey } = props;
  const version = `${site.scans.map((s) => s.project_id).join(",")}|${site.design_id}|${site.change_threshold_m}|${site.tolerance_m}|${reloadKey}`;
  const { data, loading, error } = useConditions(siteId, version, site.change_threshold_m);
  const pid = site.scans[scan]?.project_id;
  const { rasters, error: rasterError } = useFlightRasters(siteId, pid ? [pid] : [], reloadKey);
  const r = rasters[0] ?? null;
  const [choice, setChoice] = useState<LayerKind>("photo");
  const [drawing, setDrawing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const f = data?.flights[scan] ?? null;
  const marks = data?.marks[scan] ?? null;
  const cells = surfaces.nx * surfaces.ny;
  const cellArea = surfaces.cell * surfaces.cell;
  const sameGrid = !!data && data.nx === surfaces.nx && data.ny === surfaces.ny;

  // the site's own outlines on the grid (instant when redrawn)
  const lodMask = useMemo(() => (site.lod ? cellMask(zoneCells(surfaces, site.lod), cells) : null), [site.lod, surfaces, cells]);
  const limits = marks && sameGrid ? outsideLimits(marks, lodMask, cellArea) : null;
  const ponds = useMemo(
    () => (site.ponds ?? []).flatMap((p) => {
      const z = site.zones.find((zz) => zz.id === p.zone_id);
      return z ? [{ name: z.name, mask: cellMask(zoneCells(surfaces, z.polygon), cells)! }] : [];
    }),
    [site.ponds, site.zones, surfaces, cells]
  );
  const sediments = data && marks && sameGrid && scan > 0
    ? ponds.flatMap((p) => {
        const s = pondSediment(data, marks, p.mask, surfaces.scans[scan], surfaces.scans[scan - 1], f?.storm.offset_m ?? 0);
        return s ? [{ ...s, pond: p.name }] : [];
      })
    : [];
  const findings = f && scan > 0 ? stormFindings(site, f, sediments) : [];
  const repairs = findings.filter((x) => x.severity === "repair").length;

  // colour: without it, start on intensity (or plain relief)
  const hasPhoto = !!r?.photo;
  const hasIntensity = !!r?.intensity;
  const layer: LayerKind = choice === "storm" && scan === 0 ? "disturbed" : choice === "photo" && r && !hasPhoto ? (hasIntensity ? "intensity" : "vegetation") : choice === "intensity" && r && !hasIntensity ? "vegetation" : choice;

  const overlay = useMemo(
    () =>
      conditionsLayer({
        kind: layer,
        cells,
        cellArea,
        photo: r?.photo,
        intensity: r?.intensity,
        vegHeight: r?.vegHeight,
        objectHeight: r?.objectHeight,
        groundDensity: r?.groundDensity,
        coverage: r?.coverage,
        marks: sameGrid ? marks : null,
        outside: limits?.outside,
      }),
    [layer, r, marks, limits?.outside, cells, cellArea, sameGrid]
  );

  const shapes: PlanShape[] = [
    ...site.zones.map((z) => ({ id: `zone-${z.id}`, points: z.polygon, color: z.color, fill: false, dashed: true })),
    ...(site.lod ? [{ id: "lod", points: site.lod, color: "#f5f5f5", fill: false, label: layer === "disturbed" ? "Limits of disturbance" : undefined }] : []),
    ...(layer === "storm" ? (f?.storm.rills ?? []).map((rl, i) => ({ id: `rill${i}`, points: rl.line, color: "#e54842", closed: false })) : []),
  ];
  const markers: PlanMarker[] = [];
  if (f && layer === "objects")
    f.machines.forEach((m, i) =>
      markers.push({ id: `m${i}`, e: m.e, n: m.n, label: `${i + 1}`, tone: "warn", title: `Machine ${i + 1}: about ${formatLength(m.length_m)} × ${formatLength(m.width_m)}, ${formatLength(m.height_m)} tall` })
    );
  if (layer === "storm")
    findings.forEach((x, i) => markers.push({ id: x.id, e: x.e, n: x.n, label: `${i + 1}`, tone: x.severity === "repair" ? "bad" : "warn", title: findingTitle(x) }));

  const readout = (i: number): ReadoutRow[] => {
    if (!r) return [];
    const rows: ReadoutRow[] = [];
    const v = r.vegHeight[i], o = r.objectHeight[i];
    if (Number.isFinite(v) && v >= 0.3) rows.push({ label: v > 1.5 ? "Tree canopy" : "Brush", value: formatLength(v) });
    if (Number.isFinite(o) && o >= 0.5) rows.push({ label: "Object height", value: formatLength(o) });
    rows.push({ label: "Ground points", value: `${r.groundDensity[i]} in this cell` });
    if (marks && sameGrid) {
      if (limits?.outside[i]) rows.push({ label: "Disturbed", value: "outside the limits", tone: "cut" });
      else if (marks[i] & MARK.MOVED) rows.push({ label: "Ground", value: "worked since the first flight" });
      else if (marks[i] & MARK.CLEARED) rows.push({ label: "Vegetation", value: "cleared since the first flight" });
      if (marks[i] & MARK.RILL) rows.push({ label: "Storm", value: "erosion rill", tone: "cut" });
      if (marks[i] & MARK.WATER) rows.push({ label: "Storm", value: "no return: possibly water" });
    }
    return rows;
  };

  const lodDrawn = (pts: [number, number][]) => {
    setDrawing(false);
    state.update((s) => ({ ...s, lod: pts }));
  };

  const veg = f?.vegetation;
  const firstDate = surfaces.dates[0];
  const prevDate = scan > 0 ? surfaces.dates[scan - 1] : null;
  const disturbed = f?.disturbed.total_m2 ?? 0;
  const noData = !data && (loading || error);

  return (
    <>
      {error && <div className="notice-card warn"><p>{error}. Check that the engine is running, then reopen the tab.</p></div>}
      {noData && !error && (
        <div className="notice-card">
          <p><span className="spinner" aria-hidden="true" /> Reading every flight of the site — the first time takes a few seconds per flight.</p>
        </div>
      )}

      <div className="site-kpis">
        <div className="kpi">
          <span className="kpi-label" title="Ground that moved more than the change threshold since the first flight, plus vegetation cleared since then">Disturbed ground</span>
          <strong className="fig">{f ? quantityText(formatArea(disturbed)) : "—"}</strong>
          <span className="kpi-sub">
            {f ? (needsStormwaterPermit(disturbed) ? `${acres(disturbed)} acres: over 1 acre needs a stormwater permit (NPDES)` : `since ${formatDate(firstDate, true)}; under 1 acre`) : "loading"}
          </span>
        </div>
        <div className={`kpi ${limits && limits.outside_m2 > 0 ? "bad" : ""}`}>
          <span className="kpi-label" title="Disturbed ground outside the limits of disturbance (LOD) drawn on the site plan">Outside the limits</span>
          <strong className="fig">{!site.lod ? "—" : limits ? area(limits.outside_m2) : "—"}</strong>
          <span className="kpi-sub">{!site.lod ? "draw the limits of disturbance on the map" : limits && limits.outside_m2 > 0 ? "disturbed beyond the limits — see the map" : "everything inside the limits"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label" title="Machines standing on site when the drone flew">Machines on site</span>
          <strong className="fig">{f ? f.machines.length : "—"}</strong>
          <span className="kpi-sub">at flight time — a snapshot, not a log</span>
        </div>
        <div className={`kpi ${repairs ? "bad" : ""}`}>
          <span className="kpi-label" title="Erosion rills, possible standing water and pond silt since the flight before">Storm check</span>
          <strong className="fig">{scan === 0 ? "—" : f ? findings.length : "—"}</strong>
          <span className="kpi-sub">{scan === 0 ? "first flight: nothing to compare with" : findings.length ? `${repairs} to repair, ${findings.length - repairs} to watch (vs ${formatDate(prevDate!, true)})` : `nothing found since ${formatDate(prevDate!, true)}`}</span>
        </div>
      </div>

      <div className="site-grid">
        <section className="site-card site-map-card wide">
          <div className="site-card-head">
            <div className="segmented cond-layers" role="group" aria-label="Map layer">
              {LAYERS.map(([k, label, tip]) => (
                <button
                  key={k}
                  aria-pressed={layer === k}
                  onClick={() => setChoice(k)}
                  title={k === "photo" && r && !hasPhoto ? "This flight has no colour" : tip}
                  disabled={(k === "photo" && !!r && !hasPhoto) || (k === "intensity" && !!r && !hasIntensity) || ((k === "storm") && scan === 0)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="site-card-tools">
              <button className={drawing ? "primary-btn compact" : "secondary-btn"} onClick={() => { setDrawing((d) => !d); setChoice("disturbed"); }}>
                <Icon name="plus" size={14} /> {drawing ? "Drawing…" : site.lod ? "Redraw limits" : "Draw limits"}
              </button>
              {site.lod && !drawing && (
                <button className="secondary-btn" onClick={() => setConfirmDelete(true)} title="Delete the limits of disturbance">
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          </div>
          {r && !hasPhoto && (
            <p className="panel-note cond-note">This flight has no colour — turn on colour (RGB) in the drone's processing export. Showing {hasIntensity ? "intensity" : "relief"} instead.</p>
          )}
          {rasterError && <p className="panel-note cond-note">{rasterError}</p>}
          <PlanView
            grid={surfaces}
            relief={surfaces.scans[scan]}
            layer={overlay}
            shapes={shapes}
            markers={markers}
            readout={readout}
            draw={drawing ? { kind: "polygon", hint: "Click around the limits of disturbance shown on the permit plans", onDone: lodDrawn, onCancel: () => setDrawing(false) } : null}
            ariaLabel="Site plan with the flight's conditions"
          />
          <Legend layer={layer} hasLod={!!site.lod} cell={surfaces.cell} />
        </section>

        <section className="site-card wide">
          <h3>
            Storm & erosion check {prevDate && <span className="site-card-note">{formatDate(prevDate)} → {formatDate(surfaces.dates[scan])}</span>}
          </h3>
          {scan === 0 ? (
            <p className="panel-note">This is the first flight. Pick a later flight in the timeline to compare it with the one before — after a storm, fly as soon as the site is safe.</p>
          ) : !f ? null : findings.length === 0 ? (
            <p className="panel-note">No erosion rills, standing water or pond silt found since the flight before. Rills narrower than about {formatDistance(0.3)}, or shallower than {formatSmall(Math.max(site.change_threshold_m, 0.05), { style: "whole" })}, can't be seen.</p>
          ) : (
            <ol className="cond-findings">
              {findings.map((x, i) => (
                <li key={x.id} data-selected={picked === x.id || undefined} onClick={() => { setPicked(x.id); setChoice("storm"); }}>
                  <span className="cond-num fig">{i + 1}</span>
                  <span className={`status-chip ${x.severity === "repair" ? "bad" : "muted"}`}>{x.severity === "repair" ? "Repair" : "Watch"}</span>
                  <span className="cond-finding-text">{findingTitle(x)}</span>
                </li>
              ))}
            </ol>
          )}
          {f && scan > 0 && Math.abs(f.storm.offset_m) >= 0.01 && (
            <p className="panel-note">This flight sits {formatSmall(Math.abs(f.storm.offset_m))} {f.storm.offset_m > 0 ? "higher" : "lower"} overall than the one before (a survey-setup offset, see Control & accuracy); it was removed before comparing.</p>
          )}
          <p className="site-legend-note cond-foot">
            Rills are found from the flight's own ground points: a channel at least {formatDistance(3)} long, lower than the ground on both sides by more than the change threshold. Depth is "up to" (narrow rills read a little shallow). Possible standing water = a patch with no laser return where the flight before saw ground. Pond silt = new dark, wet ground (intensity) or ground that rose in a pond where no fill is designed.
          </p>
        </section>

        <section className="site-card">
          <h3>Disturbed area & limits</h3>
          {limits && limits.outside_m2 > 0 && (
            <div className="notice-card cond-bad">
              <p>
                <strong>{area(limits.outside_m2)} disturbed outside the limits of disturbance</strong>
                {limits.movedOutside_m2 > 0 && ` (${area(limits.movedOutside_m2)} of it ground moved, the rest vegetation cleared)`}. Stormwater permits don't allow work there: pull material back, restore the ground and check the silt fence. Shown in red on the Disturbed layer.
              </p>
            </div>
          )}
          {!site.lod && (
            <p className="panel-note">No limits of disturbance yet. Click <strong>Draw limits</strong> and trace the LOD line from the erosion-control plan to be warned when work strays outside it.</p>
          )}
          {data && (
            <PerFlightBars
              data={data}
              scan={scan}
              value={(k) => data.flights[k].disturbed.total_m2}
              label={(v) => area(v)}
              mark={(v) => needsStormwaterPermit(v)}
              onPick={(k) => onScan(site.scans[k]?.project_id ?? null)}
              dates={surfaces.dates}
              ariaLabel="Disturbed area per flight"
            />
          )}
          {f && (
            <p className="site-legend-note cond-foot">
              Disturbed = ground that moved more than {formatSmall(site.change_threshold_m, { style: "whole" })} since {formatDate(firstDate)} ({area(f.disturbed.moved_m2)}) or lost its vegetation ({area(f.disturbed.cleared_m2)}), on {formatDistance(surfaces.cell)} cells — the edge is ± one cell. Bars marked ● are over 1 acre (NPDES permit).
              {Math.abs(f.offset_vs_first_m) >= 0.01 && ` This flight reads ${formatSmall(Math.abs(f.offset_vs_first_m))} ${f.offset_vs_first_m > 0 ? "high" : "low"} overall; that offset was removed before comparing.`}
            </p>
          )}
        </section>

        <section className="site-card">
          <h3>Clearing & vegetation</h3>
          {!r?.classified && r && <p className="panel-note">This flight has no ground / vegetation classes, so trees and brush can't be told from the ground. Ask for a classified (LAS 1.4, ground + vegetation) export.</p>}
          {veg && (
            <dl className="metric-list cond-metrics">
              <div><dt title={`Vegetation taller than ${formatDistance(1.5)}`}>Tree canopy</dt><dd className="fig">{area(veg.canopy_m2)}</dd></div>
              <div><dt title={`Vegetation ${formatDistance(0.3)}–${formatDistance(1.5)} tall`}>Brush</dt><dd className="fig">{area(veg.brush_m2)}</dd></div>
              <div><dt title="Canopy tops: trees whose crowns merge into one top count once">Trees (about)</dt><dd className="fig">{veg.trees}</dd></div>
              <div><dt>Cleared since last flight</dt><dd className="fig">{scan > 0 ? area(f!.cleared_since_previous_m2) : "—"}</dd></div>
            </dl>
          )}
          {data && (
            <PerFlightBars data={data} scan={scan} value={(k) => data.flights[k].vegetation.canopy_m2} label={(v) => area(v)} onPick={(k) => onScan(site.scans[k]?.project_id ?? null)} dates={surfaces.dates} ariaLabel="Tree canopy per flight" tone="green" />
          )}
          <p className="site-legend-note cond-foot">Trees are counted by their tops; trees in a tight clump with one shared top count as one, so treat the count as "about". Canopy area ±5 %.</p>
        </section>

        <section className="site-card">
          <h3>Equipment on site</h3>
          {f && f.machines.length === 0 && <p className="panel-note">No machines standing on site when this flight was flown.</p>}
          {f && f.machines.length > 0 && (
            <ol className="cond-findings">
              {f.machines.map((m, i) => (
                <li key={i} onClick={() => setChoice("objects")}>
                  <span className="cond-num fig">{i + 1}</span>
                  <span className="cond-finding-text">
                    Machine, about {formatLength(m.length_m)} × {formatLength(m.width_m)}, {formatLength(m.height_m)} tall{zoneAt(site, m.e, m.n) ? `, ${zoneAt(site, m.e, m.n)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {data && (
            <PerFlightBars data={data} scan={scan} value={(k) => data.flights[k].machines.length} label={(v) => `${v}`} onPick={(k) => onScan(site.scans[k]?.project_id ?? null)} dates={surfaces.dates} ariaLabel="Machines per flight" tone="amber" />
          )}
          {data && (
            <p className="site-legend-note cond-foot">
              {data.flights.reduce((s, x) => s + x.machines.length, 0)} machine sightings over {data.flights.length} flights. Each flight is a snapshot of one moment — a rough sign of how busy the site is, not an equipment log. Machines are things {formatDistance(1.5)}–{formatDistance(5)} tall with a machine-sized footprint; two parked nose to tail may read as one.
            </p>
          )}
        </section>

        <section className="site-card">
          <h3>Flight coverage</h3>
          {f && (
            <>
              <dl className="metric-list cond-metrics">
                <div><dt title="Share of the flown area with too few ground points to measure well">Thin ground</dt><dd className="fig">{((100 * f.coverage.thin_m2) / Math.max(f.coverage.covered_m2, 1)).toFixed(1)}%</dd></div>
                <div><dt>Thin area</dt><dd className="fig">{area(f.coverage.thin_m2)}</dd></div>
                <div><dt>Typical ground points</dt><dd className="fig">{f.coverage.ground_per_m2.toFixed(0)} per {area(1)}</dd></div>
              </dl>
              <p className="site-legend-note cond-foot">
                Thin = fewer than one ground point per {area(1)}. There the ground is filled in from around it, so volumes and levels lean on guesswork. Expect it under trees and machines; a big thin patch elsewhere means a re-fly (lower, slower or more overlap). See the Coverage layer.
              </p>
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete the limits of disturbance?"
        confirmLabel="Delete limits"
        onConfirm={() => {
          state.update((s) => ({ ...s, lod: null }));
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>The outline is removed and work outside it is no longer flagged. You can draw it again any time.</p>
      </ConfirmDialog>
    </>
  );
}

/** Tab badge: rills to repair on the picked flight, plus one if anything is disturbed outside the limits. */
export function conditionsCount({ siteId, site, surfaces, scan }: SiteTabProps): number | null {
  const c = peekConditions(siteId);
  const f = c?.flights[scan];
  if (!c || !f || c.nx !== surfaces.nx || c.ny !== surfaces.ny) return null;
  const repairs = scan > 0 ? f.storm.rills.filter((r) => rillSeverity(r) === "repair").length : 0;
  const lod = site.lod ? cellMask(zoneCells(surfaces, site.lod), c.nx * c.ny) : null;
  const out = outsideLimits(c.marks[scan], lod, c.cell * c.cell);
  const n = repairs + (out && out.outside_m2 > 0 ? 1 : 0);
  return n || null;
}

function findingTitle(x: StormFinding): string {
  const where = x.where ? `, ${x.where}` : ", outside the work zones";
  if (x.kind === "rill" && x.rill)
    return `Erosion rill, ${formatLength(x.rill.length_m)} long, up to ${formatLength(x.rill.depth_m)} deep (about ${quantityText(formatVolume(x.rill.volume_m3))} washed out)${where}${x.rill.worked ? " — on ground being worked" : ""}`;
  if (x.kind === "water" && x.water) return `No laser return over ${area(x.water.area_m2)} — possibly standing water${where}`;
  if (x.kind === "sediment" && x.sediment)
    return `Fresh silt over ${area(x.sediment.area_m2)} in ${x.sediment.pond}${x.sediment.measured_m3 > 0.5 ? `, at least ${quantityText(formatVolume(x.sediment.measured_m3))}` : " (depth can't be measured: the pond was being dug at the same time)"} — check its storage`;
  return "Finding";
}

function PerFlightBars(props: {
  data: Conditions;
  scan: number;
  dates: string[];
  value: (k: number) => number;
  label: (v: number) => string;
  mark?: (v: number) => boolean;
  onPick: (k: number) => void;
  ariaLabel: string;
  tone?: "green" | "amber";
}) {
  const { data, scan, dates, value, label, mark, onPick, ariaLabel, tone } = props;
  const vals = data.flights.map((_, k) => value(k));
  const max = Math.max(...vals, 1e-9);
  return (
    <div className={`cond-bars ${tone ?? ""}`} role="group" aria-label={ariaLabel}>
      {vals.map((v, k) => (
        <button key={k} aria-pressed={k === scan} onClick={() => onPick(k)} title={`${formatDate(dates[k])}: ${label(v)}`}>
          <span className="cond-bar-val fig">{label(v)}</span>
          <span className="cond-bar-track">
            <i style={{ height: `${(100 * v) / max}%` }} />
          </span>
          <span className="cond-bar-date">{formatDate(dates[k], true)}{mark?.(v) ? " ●" : ""}</span>
        </button>
      ))}
    </div>
  );
}

function Legend({ layer, hasLod, cell }: { layer: LayerKind; hasLod: boolean; cell: number }) {
  const sw = (c: Parameters<typeof swatch>[0]) => <i className="sw" style={{ background: swatch(c) }} />;
  const items: Record<LayerKind, JSX.Element> = {
    photo: <span className="site-legend-note">the flight's own photo, seen from above (tree tops and machines as they were) · dashed: work zones</span>,
    intensity: (
      <>
        <span><i className="sw cond-ramp" /> dark → bright</span>
        <span className="site-legend-note">laser reflectance of the ground: bright = aggregate, concrete, dry fill · dark = wet ground, silt, topsoil, organic matter</span>
      </>
    ),
    vegetation: (
      <>
        <span>{sw(LAYER_COLOURS.brush)} brush {formatDistance(0.3)}–{formatDistance(1.5)}</span>
        <span>{sw(LAYER_COLOURS.canopyLow)} trees from {formatDistance(1.5)}</span>
        <span>{sw(LAYER_COLOURS.canopyHigh)} {formatDistance(20)} +</span>
      </>
    ),
    objects: (
      <>
        <span>{sw(LAYER_COLOURS.machine)} {formatDistance(1.5)} + tall (machines, numbered)</span>
        <span>{sw(LAYER_COLOURS.object)} lower objects (pipe, materials)</span>
      </>
    ),
    disturbed: (
      <>
        <span>{sw(LAYER_COLOURS.moved)} ground worked since the first flight</span>
        <span>{sw(LAYER_COLOURS.cleared)} vegetation cleared</span>
        {hasLod ? <span>{sw(LAYER_COLOURS.outside)} disturbed outside the limits (white line)</span> : <span className="site-legend-note">draw the limits of disturbance to check them</span>}
      </>
    ),
    storm: (
      <>
        <span>{sw(LAYER_COLOURS.rill)} erosion rill</span>
        <span>{sw(LAYER_COLOURS.water)} no return: possibly standing water</span>
        <span>{sw(LAYER_COLOURS.sediment)} silt / new wet ground (counted in ponds)</span>
      </>
    ),
    coverage: (
      <>
        <span>{sw(LAYER_COLOURS.thin)} under 1 ground point per {quantityText(formatArea(1))}</span>
        <span>{sw(LAYER_COLOURS.sparse)} under 2</span>
        <span className="site-legend-note">{formatDistance(cell)} cells · thin ground is filled in for volumes</span>
      </>
    ),
  };
  return <div className="site-legend">{items[layer]}</div>;
}
