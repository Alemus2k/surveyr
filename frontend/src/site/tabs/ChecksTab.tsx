import { useMemo, useState } from "react";
import { QuantityInput } from "../../components/QuantityInput";
import { ConfirmDialog } from "../../layout/ConfirmDialog";
import { Icon } from "../../layout/icons";
import { formatArea, formatCoordinate, formatElevation, formatLength, formatSmall, quantityText, useUnitSystem } from "../../lib/units";
import { formatDate } from "../dates";
import { PlanView, paintLayer, type PlanMarker, type PlanShape, type ReadoutRow } from "../PlanView";
import {
  DEFAULT_PIPE_M,
  monitorFinding,
  parsePipeSize,
  pct,
  pipeFallText,
  pipeLabel,
  pipeSizes,
  recordCsv,
  recordText,
  stretchFinding,
  trenchFinding,
  verdictHeadline,
  withPipeSize,
  formatStation,
  type Finding,
} from "../checks";
import {
  fetchFlatwork,
  fetchMonitor,
  fetchSections,
  fetchTrench,
  useCheck,
  useChecks,
  type FlatworkResult,
  type MonitorResult,
  type TrenchResult,
} from "../checksApi";
import type { Alignment, AsBuilt, Flatwork, Monitor, Site } from "../types";
import { MovementChart, ProfileChart, SlopeStrip, type Series } from "./ChecksCharts";
import type { SiteTabProps } from "./types";
import "./checks.css";

type Tool = "sections" | "trench" | "walks" | "settlement";
type ListKey = "alignments" | "asbuilts" | "flatwork" | "monitors";
const TOOLS: ReadonlyArray<[Tool, string, ListKey]> = [
  ["trench", "Trench records", "asbuilts"],
  ["walks", "Walks & ramps", "flatwork"],
  ["settlement", "Settlement", "monitors"],
  ["sections", "Cross-sections", "alignments"],
];
const KIND_LABELS: Record<Flatwork["kind"], string> = { walk: "Walk", ramp: "Ramp", landing: "Landing", parking: "Accessible parking" };
const LINE_COLOURS: Record<Tool, string> = { sections: "#4db5cf", trench: "#c27ad6", walks: "#e2bd48", settlement: "#998af0" };
const newId = (p: string) => `${p}${Date.now().toString(36)}`;
const pipeOf = (a: AsBuilt) => parsePipeSize(a.note) ?? DEFAULT_PIPE_M;

interface Item {
  id: string;
  name: string;
}

/** Things to check before the inspector does, and permanent records of what gets buried. */
export function ChecksTab(props: SiteTabProps) {
  useUnitSystem();
  const { siteId, site, surfaces, state, scan, reloadKey } = props;
  const [tool, setTool] = useState<Tool>("trench");
  const [selected, setSelected] = useState<Record<Tool, string | null>>({ sections: null, trench: null, walks: null, settlement: null });
  const [draw, setDraw] = useState<{ tool: Tool; id: string | null } | null>(null);
  const [deleting, setDeleting] = useState<{ key: ListKey; id: string; name: string } | null>(null);

  const scanId = site.scans[scan]?.project_id ?? null;
  const scanIds = site.scans.map((s) => s.project_id);
  const dateOf = (pid: string) => site.scans.find((s) => s.project_id === pid)?.date ?? null;
  const alignments = site.alignments ?? [];
  const asbuilts = site.asbuilts ?? [];
  const flatwork = site.flatwork ?? [];
  const monitors = site.monitors ?? [];

  // every item's check, for the verdict (cached in checksApi, shared with the detail views)
  const trench = useChecks(siteId, "trench",
    asbuilts.map((a) => (scanIds.includes(a.scan) ? { scan: a.scan, line: a.line, diameter_m: pipeOf(a) } : null)), fetchTrench, reloadKey);
  const walks = useChecks(siteId, "flatwork",
    flatwork.map((f) => (scanId ? { scan: scanId, kind: f.kind, polygon: f.polygon } : null)), fetchFlatwork, reloadKey);
  const watch = useChecks(siteId, "monitor",
    monitors.map((m) => ({ polygon: m.polygon, baseline_scan: m.baseline_scan, alert_m: m.alert_m })), fetchMonitor, reloadKey);

  const findings = useMemo(() => {
    const out: { tool: Tool; id: string; item: string; f: Finding }[] = [];
    asbuilts.forEach((a, i) => trench[i].data?.flags?.forEach((fl) => fl.level !== "info" && out.push({ tool: "trench", id: a.id, item: a.name, f: trenchFinding(fl) })));
    flatwork.forEach((w, i) => {
      const r = walks[i].data;
      r?.stretches?.forEach((s) => stretchFinding(s, r).forEach((f) => out.push({ tool: "walks", id: w.id, item: w.name, f })));
    });
    monitors.forEach((m, i) => {
      const f = monitorFinding(m.name, watch[i].data?.flights[scan], m.alert_m);
      if (f && f.level === "bad") out.push({ tool: "settlement", id: m.id, item: m.name, f });
    });
    return out;
  }, [asbuilts, flatwork, monitors, trench, walks, watch, scan]);
  const problems = findings.filter((x) => x.f.level === "bad");
  const toCheck = findings.filter((x) => x.f.level === "warn");
  const busy = [...trench, ...walks, ...watch].some((c) => c.loading);

  const listKey = TOOLS.find((t) => t[0] === tool)![2];
  const items = (site[listKey] ?? []) as Item[];
  const selId = selected[tool] && items.some((i) => i.id === selected[tool]) ? selected[tool] : items[0]?.id ?? null;
  const select = (t: Tool, id: string | null) => setSelected((s) => ({ ...s, [t]: id }));

  const patch = <K extends ListKey>(key: K, id: string, change: Partial<NonNullable<Site[K]>[number]>) =>
    state.update((s) => ({ ...s, [key]: ((s[key] ?? []) as Item[]).map((x) => (x.id === id ? { ...x, ...change } : x)) }));

  const drawn = (pts: [number, number][]) => {
    if (!draw) return;
    const t = draw.tool;
    const key = TOOLS.find((x) => x[0] === t)![2];
    setDraw(null);
    if (draw.id) {
      patch(key, draw.id, (t === "sections" ? { points: pts } : t === "trench" ? { line: pts } : { polygon: pts }) as never);
      return;
    }
    const n = ((site[key] ?? []) as Item[]).length + 1;
    let item: Alignment | AsBuilt | Flatwork | Monitor;
    if (t === "sections") item = { id: newId("al"), name: `Alignment ${n}`, points: pts, interval_m: 15.24 /* 50 ft */, half_width_m: 10 };
    else if (t === "trench") item = { id: newId("ab"), name: `Trench ${n}`, kind: "trench", scan: scanId ?? site.scans[site.scans.length - 1].project_id, line: pts, note: "" };
    else if (t === "walks") item = { id: newId("fw"), name: `Walk ${n}`, kind: "walk", polygon: pts };
    else item = { id: newId("mo"), name: `Monitor ${n}`, polygon: pts, baseline_scan: null, alert_m: 0.025 };
    state.update((s) => ({ ...s, [key]: [...((s[key] ?? []) as Item[]), item] }));
    select(t, item.id);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    state.update((s) => ({ ...s, [deleting.key]: ((s[deleting.key] ?? []) as Item[]).filter((x) => x.id !== deleting.id) }));
    setDeleting(null);
  };

  // ---------------------------------------------------------------- map
  const grid = { nx: surfaces.nx, ny: surfaces.ny, cell: surfaces.cell, x0: surfaces.x0, y0: surfaces.y0 };
  const iSel = items.findIndex((i) => i.id === selId);
  const sectionsReq = tool === "sections" && iSel >= 0 && scanId
    ? { scan: scanId, points: alignments[iSel].points, interval_m: alignments[iSel].interval_m, half_width_m: alignments[iSel].half_width_m }
    : null;
  const sections = useCheck(siteId, "sections", sectionsReq, fetchSections, reloadKey);
  const [sectionAt, setSectionAt] = useState(0);
  const secIdx = Math.min(sectionAt, Math.max(0, (sections.data?.sections.length ?? 1) - 1));

  const shapes: PlanShape[] = [];
  const markers: PlanMarker[] = [];
  const add = (t: Tool, list: { id: string; name: string }[], geom: (x: never) => [number, number][], closed: boolean) =>
    list.forEach((x) =>
      shapes.push({ id: `${t}:${x.id}`, points: geom(x as never), color: LINE_COLOURS[t], closed, label: tool === t ? x.name : undefined, selected: tool === t && x.id === selId, dashed: tool !== t, fill: closed && tool === t })
    );
  add("sections", alignments, (a: Alignment) => a.points, false);
  add("trench", asbuilts, (a: AsBuilt) => a.line, false);
  add("walks", flatwork, (f: Flatwork) => f.polygon, true);
  add("settlement", monitors, (m: Monitor) => m.polygon, true);
  let layer: Uint8ClampedArray | null = null;
  let readout: ((i: number) => ReadoutRow[]) | undefined;
  const walkSel = tool === "walks" && iSel >= 0 ? walks[iSel].data : null;
  const monSel = tool === "settlement" && iSel >= 0 ? watch[iSel].data : null;
  const trenchSel = tool === "trench" && iSel >= 0 ? trench[iSel].data : null;
  if (walkSel?.stretches)
    walkSel.stretches.forEach((s, k) =>
      shapes.push({ id: `stretch${k}`, points: s.outline, color: s.status === "fail" ? "#ef6f69" : s.status === "check" ? "#eeb02b" : "#4cbf86", closed: true, fill: true })
    );
  if (tool === "sections" && sections.data) {
    const sec = sections.data.sections[secIdx];
    if (sec) shapes.push({ id: "section", points: sec.line, color: "#eeb02b", closed: false, selected: true });
    sections.data.sections.forEach((s, k) => k % Math.max(1, Math.ceil(sections.data!.sections.length / 8)) === 0 && markers.push({ id: `st${k}`, e: s.e, n: s.n, label: formatStation(s.station), tone: "info" }));
  }
  if (trenchSel?.open && trenchSel.table?.length) {
    const t0 = trenchSel.table[0], t1 = trenchSel.table[trenchSel.table.length - 1];
    markers.push({ id: "ts", e: t0.e, n: t0.n, label: formatStation(t0.station), tone: "info" }, { id: "te", e: t1.e, n: t1.n, label: formatStation(t1.station), tone: "info" });
  }
  if (monSel && monSel.movement[scan]) {
    const mv = monSel.movement[scan];
    const { c0, r0, nx } = monSel.grid;
    const full = new Float64Array(grid.nx * grid.ny).fill(NaN);
    mv.forEach((v, k) => {
      if (v === null) return;
      full[(r0 + Math.floor(k / nx)) * grid.nx + c0 + (k % nx)] = v;
    });
    const a = monSel.alert_m;
    layer = paintLayer(full.length, (i) => {
      const v = full[i];
      if (!Number.isFinite(v) || Math.abs(v) < a / 4) return null;
      return v < 0 ? [239, 111, 105, Math.min(0.9, Math.abs(v) / a)] : [91, 141, 239, Math.min(0.9, v / a)];
    });
    readout = (i) => (Number.isFinite(full[i]) ? [{ label: "Moved", value: formatSmall(full[i], { signed: true }), tone: full[i] < 0 ? "cut" : "fill" }] : []);
  }

  const drawKind = draw && (draw.tool === "sections" || draw.tool === "trench") ? "line" : "polygon";
  const drawHint: Record<Tool, string> = {
    sections: "Click along the centreline (road, swale, pipe run)",
    trench: "Click along the trench's centreline, end to end",
    walks: "Click the corners of the walk, ramp, landing or stall",
    settlement: "Click around the area to watch",
  };

  return (
    <>
      <section className={`site-card checks-verdict ${problems.length ? "bad" : "good"}`}>
        <div className="checks-verdict-head">
          <h3>{busy && !findings.length ? "Checking the flights…" : verdictHeadline(problems.length, toCheck.length)}</h3>
          <span className="site-card-note">walks and settlement at {formatDate(surfaces.dates[scan])}; trenches on the flight that saw them open</span>
        </div>
        {findings.length > 0 && (
          <ul className="checks-findings">
            {findings.map((x, k) => (
              <li key={k} className={x.f.level}>
                <button className="text-btn" onClick={() => { setTool(x.tool); select(x.tool, x.id); }}>
                  <strong>{x.f.title}</strong> <span className="checks-item">· {x.item}</span>
                </button>
                <span>{x.f.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {!asbuilts.length && !flatwork.length && !monitors.length && (
          <p className="panel-note">Nothing is set up to check yet. Pick a tool below and draw on the map: a trench to record, a sidewalk to check for ADA slopes, or an area to watch for settlement.</p>
        )}
      </section>

      <div className="site-kpis">
        <Kpi label="Trench prompts (OSHA)" value={asbuilts.length ? problems.filter((x) => x.tool === "trench").length : "—"} sub={`${asbuilts.length} as-built record${asbuilts.length === 1 ? "" : "s"}`} bad={problems.some((x) => x.tool === "trench")} />
        <Kpi label="Too steep for a wheelchair" value={flatwork.length ? problems.filter((x) => x.tool === "walks").length : "—"} sub={`stretches, on ${flatwork.length} walk${flatwork.length === 1 ? "" : "s"} & ramps`} bad={problems.some((x) => x.tool === "walks")} />
        <Kpi label="Areas settling past the alert" value={monitors.length ? problems.filter((x) => x.tool === "settlement").length : "—"} sub={`of ${monitors.length} watched`} bad={problems.some((x) => x.tool === "settlement")} />
        <Kpi label="Cross-section lines" value={alignments.length} sub="roads, swales, pipe runs" />
      </div>

      <div className="segmented checks-tools" role="tablist" aria-label="Check">
        {TOOLS.map(([t, label]) => (
          <button key={t} role="tab" aria-pressed={tool === t} onClick={() => { setTool(t); setDraw(null); }}>{label}</button>
        ))}
      </div>

      <div className="site-grid">
        <section className="site-card site-map-card">
          <div className="site-card-head">
            <span className="site-card-note">{surfaces.dates[scan] ? `Relief from ${formatDate(surfaces.dates[scan])}` : ""}</span>
            <div className="site-card-tools">
              <button className={draw && !draw.id ? "primary-btn compact" : "secondary-btn"} onClick={() => setDraw(draw ? null : { tool, id: null })}>
                <Icon name="plus" size={14} /> {draw && !draw.id ? "Drawing…" : { sections: "Draw alignment", trench: "Draw trench", walks: "Draw walk", settlement: "Draw area" }[tool]}
              </button>
            </div>
          </div>
          <PlanView
            grid={grid}
            relief={surfaces.scans[scan] ?? null}
            layer={layer}
            shapes={shapes}
            markers={markers}
            readout={readout}
            onPickShape={(id) => {
              if (!id) return;
              const [t, sid] = id.split(":");
              if (t === tool) select(tool, sid);
            }}
            draw={draw ? { kind: drawKind, hint: drawHint[draw.tool], onDone: drawn, onCancel: () => setDraw(null) } : null}
            ariaLabel="Site plan with the checked lines and areas"
          />
          {tool === "settlement" && monSel && (
            <div className="site-legend">
              <span><i className="sw cut" /> settled</span>
              <span><i className="sw fill" /> rose</span>
              <span className="site-legend-note">since the baseline, at {formatDate(surfaces.dates[scan])}; under {formatSmall(monSel.alert_m / 4)} not shown</span>
            </div>
          )}
          {tool === "walks" && walkSel && (
            <div className="site-legend">
              <span><i className="sw cut" /> too steep</span>
              <span><i className="sw warn" /> check with a level</span>
              <span><i className="sw ok" /> within ADA limits</span>
            </div>
          )}
        </section>

        <section className="site-card">
          <h3>{TOOLS.find((t) => t[0] === tool)![1]}</h3>
          {items.length === 0 ? (
            <p className="panel-note">{emptyText(tool)}</p>
          ) : (
            <ul className="checks-list">
              {items.map((it) => (
                <li key={it.id} data-selected={it.id === selId || undefined}>
                  <button className="text-btn" onClick={() => select(tool, it.id)}>{it.name}</button>
                  <span className="site-card-note">{itemNote(tool, it, site)}</span>
                </li>
              ))}
            </ul>
          )}
          {iSel >= 0 && (
            <Editor
              tool={tool}
              item={items[iSel]}
              site={site}
              onPatch={(change) => patch(listKey, items[iSel].id, change as never)}
              onRedraw={() => setDraw({ tool, id: items[iSel].id })}
              redrawing={draw?.id === items[iSel].id}
              onDelete={() => setDeleting({ key: listKey, id: items[iSel].id, name: items[iSel].name })}
            />
          )}
        </section>

        {iSel >= 0 && (
          <section className="site-card wide">
            {tool === "sections" && <SectionsDetail state={sections} at={secIdx} onAt={setSectionAt} dateOf={dateOf} />}
            {tool === "trench" && <TrenchDetail rec={asbuilts[iSel]} state={trench[iSel]} />}
            {tool === "walks" && <WalkDetail fw={flatwork[iSel]} state={walks[iSel]} date={surfaces.dates[scan]} />}
            {tool === "settlement" && <MonitorDetail mon={monitors[iSel]} state={watch[iSel]} picked={scan} />}
          </section>
        )}
      </div>

      <ConfirmDialog open={deleting !== null} title={`Delete “${deleting?.name ?? ""}”?`} confirmLabel="Delete" onConfirm={confirmDelete} onCancel={() => setDeleting(null)}>
        <p>The line or outline and its settings are removed. The flights aren't affected{deleting?.key === "asbuilts" ? ", but this as-built record is gone unless you exported it" : ""}.</p>
      </ConfirmDialog>
    </>
  );
}

function Kpi({ label, value, sub, bad }: { label: string; value: number | string; sub: string; bad?: boolean }) {
  return (
    <div className={`kpi ${bad ? "bad" : ""}`}>
      <span className="kpi-label">{label}</span>
      <strong className="fig">{value}</strong>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function emptyText(tool: Tool): string {
  return {
    trench: "Draw an open trench's centreline on the map (pick the flight that saw it open in the timeline first) to make a permanent as-built record and check it against OSHA.",
    walks: "Draw the sidewalk, ramp, landing or accessible stall on the map to check its slopes against the ADA limits.",
    settlement: "Draw a fill area (a parking lot, a building pad, behind a wall) to watch it settle flight by flight.",
    sections: "Draw a centreline on the map (a road, a swale) to cut cross-sections along it.",
  }[tool];
}

function itemNote(tool: Tool, it: Item, site: Site): string {
  if (tool === "trench") {
    const d = site.scans.find((s) => s.project_id === (it as AsBuilt).scan)?.date;
    return d ? `flown open ${formatDate(d, true)}` : "its flight is no longer in the site";
  }
  if (tool === "walks") return KIND_LABELS[(it as Flatwork).kind];
  if (tool === "settlement") return `alert ${formatSmall((it as Monitor).alert_m)}`;
  return `every ${formatLength((it as Alignment).interval_m)}`;
}

function Editor({ tool, item, site, onPatch, onRedraw, redrawing, onDelete }: {
  tool: Tool;
  item: Item;
  site: Site;
  onPatch: (change: object) => void;
  onRedraw: () => void;
  redrawing: boolean;
  onDelete: () => void;
}) {
  const flightOptions = site.scans.map((s) => <option key={s.project_id} value={s.project_id}>{formatDate(s.date)}</option>);
  return (
    <div className="checks-editor">
      <label className="js-field">
        <span>Name</span>
        <input value={item.name} maxLength={60} onChange={(e) => e.target.value.trim() && onPatch({ name: e.target.value })} />
      </label>
      {tool === "sections" && (
        <>
          <label className="js-field"><span>Section every</span>
            <QuantityInput kind="length" value={(item as Alignment).interval_m} min={1} max={1000} onChange={(v) => onPatch({ interval_m: v })} aria-label="Section spacing" />
          </label>
          <label className="js-field"><span>Reach either side</span>
            <QuantityInput kind="length" value={(item as Alignment).half_width_m} min={1} max={500} onChange={(v) => onPatch({ half_width_m: v })} aria-label="Section half width" />
          </label>
        </>
      )}
      {tool === "trench" && (
        <>
          <label className="js-field"><span>Flight that saw it open</span>
            <select value={(item as AsBuilt).scan} onChange={(e) => onPatch({ scan: e.target.value })}>{flightOptions}</select>
          </label>
          <label className="js-field"><span title="Used for the invert: invert = pipe top − diameter. Saved in the note.">Pipe size</span>
            <PipeSelect value={pipeOf(item as AsBuilt)} onChange={(m) => onPatch({ note: withPipeSize((item as AsBuilt).note, m) })} />
          </label>
          <label className="js-field"><span>Note</span>
            <input value={(item as AsBuilt).note} maxLength={200} placeholder="e.g. 18 in RCP storm drain to the pond" onChange={(e) => onPatch({ note: e.target.value })} />
          </label>
        </>
      )}
      {tool === "walks" && (
        <label className="js-field"><span>What it is</span>
          <select value={(item as Flatwork).kind} onChange={(e) => onPatch({ kind: e.target.value })}>
            {(Object.keys(KIND_LABELS) as Flatwork["kind"][]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
      )}
      {tool === "settlement" && (
        <>
          <label className="js-field"><span>Alert when it moves</span>
            <QuantityInput kind="small" value={(item as Monitor).alert_m} min={0.005} max={2} onChange={(v) => onPatch({ alert_m: v })} aria-label="Alert movement" />
          </label>
          <label className="js-field"><span title="Auto: each spot's own first flight after the fill stopped changing">Measure from</span>
            <select value={(item as Monitor).baseline_scan ?? ""} onChange={(e) => onPatch({ baseline_scan: e.target.value || null })}>
              <option value="">Auto — once the fill is in</option>
              {flightOptions}
            </select>
          </label>
        </>
      )}
      <div className="checks-editor-actions">
        <button className="secondary-btn" onClick={onRedraw}>{redrawing ? "Drawing on the map…" : "Redraw on map"}</button>
        <button className="text-btn checks-delete" onClick={onDelete}><Icon name="trash" size={14} /> Delete</button>
      </div>
    </div>
  );
}

function PipeSelect({ value, onChange }: { value: number; onChange: (m: number) => void }) {
  const sizes = pipeSizes();
  const near = sizes.find(([m]) => Math.abs(m - value) < 0.02);
  const opts = near ? sizes : [[value, pipeLabel(value)] as [number, string], ...sizes];
  return (
    <select value={String(near ? near[0] : value)} onChange={(e) => onChange(Number(e.target.value))}>
      {opts.map(([m, label]) => <option key={label} value={String(m)}>{label}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------- detail views

function Loading({ error, what }: { error: string | null; what: string }) {
  return error ? <p className="notice-card">{error}</p> : <p className="panel-note"><span className="spinner" aria-hidden="true" /> {what}</p>;
}

function SectionsDetail({ state, at, onAt, dateOf }: {
  state: { data: import("../checksApi").SectionsResult | null; error: string | null };
  at: number;
  onAt: (i: number) => void;
  dateOf: (pid: string) => string | null;
}) {
  const r = state.data;
  if (!r) return <Loading error={state.error} what="Cutting sections from the flight's points…" />;
  const fDate = dateOf(r.scan), pDate = r.previous_scan ? dateOf(r.previous_scan) : null;
  const series = (xs: number[], s: { flight: (number | null)[]; previous: (number | null)[] | null; design: (number | null)[] | null }): Series[] => [
    ...(s.design ? [{ key: "d", label: "design", xs, zs: s.design, tone: "design" as const }] : []),
    ...(s.previous && pDate ? [{ key: "p", label: formatDate(pDate), xs, zs: s.previous, tone: "previous" as const }] : []),
    { key: "f", label: fDate ? formatDate(fDate) : "this flight", xs, zs: s.flight, tone: "flight" as const },
  ];
  const sec = r.sections[at];
  const offs = sec ? sec.offset.map((v) => v ?? NaN) : [];
  const mid = offs.length ? offs.reduce((b, v, i) => (Math.abs(v) < Math.abs(offs[b]) ? i : b), 0) : -1;
  const fz = sec?.flight[mid], dz = sec?.design?.[mid];
  const longXs = r.long.station.map((v) => v ?? NaN);
  return (
    <>
      <h3>Long profile <span className="site-card-note">{formatLength(r.length_m)} · ground from points within {formatLength(r.long_band_m)} of the line</span></h3>
      <ProfileChart series={series(longXs, r.long)} xLabel={(m) => formatStation(m)} marker={sec?.station} ariaLabel="Ground along the alignment" />
      {sec && (
        <>
          <div className="checks-section-head">
            <h3>Section at {formatStation(sec.station)}</h3>
            <input type="range" min={0} max={r.sections.length - 1} value={at} onChange={(e) => onAt(Number(e.target.value))} aria-label="Station" />
            <span className="site-card-note">
              {fz != null && dz != null
                ? `Centreline ${formatSmall(Math.abs(fz - dz))} ${fz < dz ? "below" : "above"} design`
                : fz != null ? `Centreline at ${formatElevation(fz)}` : "No ground at the centreline"}
            </span>
          </div>
          <ProfileChart series={series(offs, sec)} xLabel={(m) => (Math.abs(m) < 1e-6 ? "CL" : `${formatLength(Math.abs(m))} ${m < 0 ? "L" : "R"}`)} marker={0} height={200} ariaLabel={`Cross-section at station ${formatStation(sec.station)}`} />
        </>
      )}
      <p className="panel-note">Each point on a line is the median of the ground points near it (a gap means none were measured). Looking along increasing stations: L = left, R = right. Drone LiDAR is ±2–5 cm.</p>
    </>
  );
}

function TrenchDetail({ rec, state }: { rec: AsBuilt; state: { data: TrenchResult | null; error: string | null } }) {
  const [copied, setCopied] = useState<string | null>(null);
  const r = state.data;
  if (!r) return <Loading error={state.error} what="Measuring the trench from the flight's points…" />;
  if (!r.open)
    return <p className="notice-card">No open trench along this line in the {formatDate(r.date)} flight. Pick the flight that saw it open (in the form above), or redraw the line along the trench's middle.</p>;
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied("Couldn't reach the clipboard");
    }
  };
  const save = () => {
    const url = URL.createObjectURL(new Blob([recordCsv(rec, r)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.name.replace(/[^\w-]+/g, "_")}_as-built_${r.date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const t = r.table ?? [];
  const xs = t.map((row) => row.station);
  const series: Series[] = [
    { key: "g", label: "ground beside it", xs, zs: t.map((row) => row.ground), tone: "flight" },
    { key: "f", label: "trench floor", xs, zs: t.map((row) => row.floor), tone: "floor" },
    ...(r.pipe?.seen ? [{ key: "p", label: "pipe top", xs, zs: t.map((row) => row.pipe_top), tone: "pipe" as const }] : []),
  ];
  const wall = (w?: { vertical: boolean; ratio_h_to_v: number | null }) =>
    !w ? "—" : w.vertical ? "near-vertical" : w.ratio_h_to_v !== null ? `sloped about ${w.ratio_h_to_v.toFixed(1)} : 1` : "not measured";
  const spoil = Object.entries(r.spoil ?? {}).filter(([, v]) => v.present);
  return (
    <>
      <div className="checks-section-head">
        <h3>As-built record <span className="site-card-note">flight {formatDate(r.date)} · {pipeLabel(r.diameter_m)} pipe</span></h3>
        <div className="site-card-tools">
          <button className="secondary-btn" onClick={() => copy("Text copied", recordText(rec, r))}>Copy as text</button>
          <button className="secondary-btn" onClick={() => copy("CSV copied — paste into a spreadsheet", recordCsv(rec, r))}>Copy CSV</button>
          <button className="secondary-btn" onClick={save}>Save CSV</button>
          {copied && <span className="site-card-note">{copied}</span>}
        </div>
      </div>
      <div className="site-kpis checks-mini">
        <Kpi label="Length" value={formatLength(r.trench_length_m ?? 0)} sub={`width ${formatLength(r.width_m ?? 0)}`} />
        <Kpi label="Depth" value={formatLength(r.depth_mean_m ?? 0)} sub={`average · deepest ${formatLength(r.depth_max_m ?? 0)}`} />
        <Kpi label="Pipe slope" value={r.pipe?.seen ? pct(r.pipe.slope_pct ?? 0, 2) : "—"} sub={r.pipe?.seen ? pipeFallText(r) : "pipe not seen"} />
        <Kpi label="Inverts" value={r.pipe?.seen ? formatElevation(r.pipe.invert_start_m ?? 0) : "—"} sub={r.pipe?.seen ? `at the start · ${formatElevation(r.pipe.invert_end_m ?? 0)} at the end` : "needs the pipe"} />
      </div>
      <ul className="checks-findings">
        {(r.flags ?? []).map((f, k) => {
          const x = trenchFinding(f);
          return <li key={k} className={x.level}><strong>{x.title}</strong><span>{x.detail}</span></li>;
        })}
      </ul>
      <p className="panel-note">
        Walls: left {wall(r.walls?.left)}, right {wall(r.walls?.right)} (looking along the line).{" "}
        {spoil.length ? spoil.map(([side, v]) => `Spoil on the ${side}: ${formatLength(v.height_m ?? 0)} high, toe ${formatLength(v.setback_m ?? 0)} from the edge.`).join(" ") : "No spoil pile beside it."}{" "}
        Invert = pipe top − the pipe size (use the outside diameter for the pipe's bottom; the inside invert is higher by the wall).
      </p>
      <ProfileChart series={series} xLabel={(m) => formatStation(m)} ariaLabel="Trench long profile" height={200} />
      <div className="zone-table-wrap">
        <table className="zone-table">
          <thead>
            <tr><th>Station</th><th className="num">Easting</th><th className="num">Northing</th><th className="num">Ground</th><th className="num">Floor</th><th className="num">Depth</th><th className="num">Width</th><th className="num">Pipe top</th><th className="num">Invert</th></tr>
          </thead>
          <tbody>
            {t.map((row) => (
              <tr key={row.station}>
                <td className="fig">{formatStation(row.station)}</td>
                <td className="num fig">{formatCoordinate(row.e)}</td>
                <td className="num fig">{formatCoordinate(row.n)}</td>
                <td className="num fig">{formatElevation(row.ground)}</td>
                <td className="num fig">{formatElevation(row.floor)}</td>
                <td className="num fig">{formatLength(row.depth)}</td>
                <td className="num fig">{formatLength(row.width)}</td>
                <td className="num fig">{row.pipe_top === null ? "—" : formatElevation(row.pipe_top)}</td>
                <td className="num fig">{row.invert === null ? "—" : formatElevation(row.invert)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="panel-note">From drone LiDAR (±2–5 cm, ±0.1 ft). The OSHA lines are prompts to check on site, not rulings — a competent person decides.</p>
    </>
  );
}

function WalkDetail({ fw, state, date }: { fw: Flatwork; state: { data: FlatworkResult | null; error: string | null }; date: string }) {
  const [comp, setComp] = useState<"cross" | "running">("cross");
  const r = state.data;
  if (!r) return <Loading error={state.error} what="Fitting slopes to the walk's points…" />;
  if (!r.enough)
    return <p className="notice-card">Too few ground points inside “{fw.name}” in the {formatDate(date)} flight to judge its slopes ({r.points}). Check the outline, or pick a flight after it was poured.</p>;
  const lines = (r.stretches ?? []).flatMap((s) => stretchFinding(s, r));
  const se = Math.min(...(r.stretches ?? []).map((s) => (comp === "cross" ? s.cross_se_pct : s.running_se_pct)));
  return (
    <>
      <div className="checks-section-head">
        <h3>{fw.name} <span className="site-card-note">{KIND_LABELS[fw.kind]} · {formatLength(r.length_m ?? 0)} long · flight {formatDate(r.date)}</span></h3>
        <div className="segmented" role="group" aria-label="Slope">
          <button aria-pressed={comp === "cross"} onClick={() => setComp("cross")}>Cross slope (≤ {r.cross_limit_pct} %)</button>
          <button aria-pressed={comp === "running"} onClick={() => setComp("running")}>Running slope (≤ {r.running_limit_pct} %)</button>
        </div>
      </div>
      <SlopeStrip
        stretches={r.stretches ?? []}
        local={r.local ?? []}
        component={comp}
        limit={comp === "cross" ? r.cross_limit_pct : r.running_limit_pct}
        length={r.length_m ?? 0}
        xLabel={(m) => formatLength(m).replace(/\.\d+/, "")}
      />
      {lines.length === 0 ? (
        <p className="checks-ok">Every stretch is within the ADA limits for a {KIND_LABELS[fw.kind].toLowerCase()} (running ≤ {r.running_limit_pct} %, cross ≤ {r.cross_limit_pct} %).</p>
      ) : (
        <ul className="checks-findings">{lines.map((f, k) => <li key={k} className={f.level}><strong>{f.title}</strong><span>{f.detail}</span></li>)}</ul>
      )}
      <p className="panel-note">
        How sure: drone LiDAR is ±2–5 cm, which over a 1 m level is ±2–5 % slope — so a stretch is only called too steep when its fitted slope is over the limit by more than twice its measuring spread
        (here ±{Number.isFinite(se) ? se.toFixed(1) : "—"} % at best, from {r.density_per_m2} points per m² and ±{formatSmall(r.noise_m ?? 0)} point noise) over at least {formatLength(3)}.
        Confirm anything flagged with a smart level before tearing out. Slopes are taken along the outline's long side: draw each straight run separately.
      </p>
    </>
  );
}

function MonitorDetail({ mon, state, picked }: { mon: Monitor; state: { data: MonitorResult | null; error: string | null }; picked: number }) {
  const r = state.data;
  if (!r) return <Loading error={state.error} what="Comparing every flight with the baseline…" />;
  const f = r.flights[picked];
  const line = monitorFinding(mon.name, f, mon.alert_m);
  const base = r.baseline === "fixed"
    ? `Measured from the ${formatDate(r.dates[r.scans.indexOf(mon.baseline_scan ?? "")] ?? r.dates[0])} flight.`
    : `Baseline: each spot's first flight after the fill stopped changing (${r.baseline_flights.filter((b) => b < r.dates.length - 1).map((b) => formatDate(r.dates[b], true)).join(", ") || "none yet"}). Rises and drops bigger than grading noise reset it, so this watches fill settling; pick a fixed flight to watch heave or natural ground.`;
  return (
    <>
      <h3>{mon.name} <span className="site-card-note">at {formatDate(r.dates[picked])}</span></h3>
      {line ? <p className={`checks-line-verdict ${line.level}`}><strong>{line.title}</strong> — {line.detail}</p> : <p className="panel-note">Nothing measured at this flight yet: the fill isn't in, or this is the baseline itself.</p>}
      {f?.measured && (
        <div className="site-kpis checks-mini">
          <Kpi label="Worst settlement" value={formatSmall(f.settled_max_m ?? 0)} sub={f.settled_e ? `at E ${formatCoordinate(f.settled_e)}, N ${formatCoordinate(f.settled_n ?? 0)}` : ""} bad={(f.settled_max_m ?? 0) >= mon.alert_m} />
          <Kpi label="Average movement" value={formatSmall(f.mean_m ?? 0, { signed: true })} sub={`± ${formatSmall(f.mean_uncertainty_m ?? 0)} over the measured area`} />
          <Kpi label="Over the alert" value={quantity(f.over_alert_m2 ?? 0)} sub={`moved more than ${formatSmall(mon.alert_m)}`} bad={!!f.alert} />
        </div>
      )}
      <MovementChart dates={r.dates} flights={r.flights} alert={mon.alert_m} picked={picked} />
      <p className="panel-note">
        {base}{" "}
        {r.levelled
          ? "Each flight is levelled to the site's check points first, so a flight that came back high or low doesn't read as movement."
          : "The site has no check points, so a whole flight coming back a few centimetres high or low would read as movement (±2–5 cm): add check points in Control & accuracy."}{" "}
        Movement is averaged over {r.window_cells} × {r.window_cells} cells ({formatLength(r.window_cells * r.cell_size)} square); one spot is good to about ±{formatSmall(f?.cell_uncertainty_m ?? 0.01)}, so only alerts covering several spots count.
      </p>
    </>
  );
}

const quantity = (m2: number) => quantityText(formatArea(m2));
