// Each dashboard tab's section of the printable site report (SiteReport.tsx).
// A section states the answer in sentences and small tables — no maps or
// interactive charts — so it prints cleanly on letter / A4 paper.
import { formatArea, formatLength, formatThickness, formatTonnage, formatVolume, quantityText } from "../../lib/units";
import { DEFAULT_PIPE_M, monitorFinding, parsePipeSize, pipeFallText, pipeLabel, stretchFinding, trenchFinding, type Finding } from "../checks";
import { fetchFlatwork, fetchMonitor, fetchTrench, useChecks } from "../checksApi";
import { conditionsSummary } from "./reportData";
import { formatDate } from "../dates";
import { overallPct } from "../progress";
import { STATUS } from "../ZoneTable";
import { useLayers, usePiles, usePonds } from "./quantities/model";
import type { SiteTabProps } from "./types";

const vol = (m3: number) => quantityText(formatVolume(m3));
const area = (m2: number) => quantityText(formatArea(m2));

export function ProgressReport({ site, surfaces, state, scan }: SiteTabProps) {
  const { progress, checks } = state;
  const grading = progress.filter((p) => p.zone.kind === "grading");
  const overall = overallPct(progress);
  const moved = progress.reduce((s, p) => s + (p.snapshots[scan]?.cut ?? 0) + (p.snapshots[scan]?.fill ?? 0), 0);
  const behind = grading.filter((p) => p.status === "behind" || p.status === "stalled");
  const flagged = checks.filter((c) => c.flagged && c.payApp.date <= surfaces.dates[scan]);
  return (
    <>
      <p className="report-lead">
        Earthworks are <strong>{overall === null ? "—" : `${overall.toFixed(0)}%`} complete</strong> across{" "}
        {grading.length} grading zone{grading.length === 1 ? "" : "s"}
        {scan > 0 && <>; {vol(moved)} moved since {formatDate(surfaces.dates[scan - 1])}</>}.{" "}
        {behind.length ? (
          <>
            <strong className="report-bad">{behind.map((p) => p.zone.name).join(", ")}</strong> {behind.length === 1 ? "is" : "are"} behind plan.
          </>
        ) : (
          "No zone is behind plan."
        )}
      </p>
      <table className="report-table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Status</th>
            <th className="num">Complete</th>
            <th className="num">Left to dig</th>
            <th className="num">Left to fill</th>
            <th className="num">Moved this period</th>
            <th>Finish (forecast / plan)</th>
          </tr>
        </thead>
        <tbody>
          {grading.map((p) => {
            const s = p.snapshots[Math.min(scan, p.snapshots.length - 1)];
            return (
              <tr key={p.zone.id}>
                <td>{p.zone.name}</td>
                <td>{STATUS[p.status].label}</td>
                <td className="num">{s?.pct == null ? "—" : `${s.pct.toFixed(0)}%`}</td>
                <td className="num">{s ? vol(s.remainingCut) : "—"}</td>
                <td className="num">{s ? vol(s.remainingFill) : "—"}</td>
                <td className="num">{s && scan > 0 ? vol(s.cut + s.fill) : "—"}</td>
                <td>
                  {p.doneOn ? `done ${formatDate(p.doneOn, true)}` : p.forecast ? formatDate(p.forecast, true) : "—"} /{" "}
                  {p.zone.finish ? formatDate(p.zone.finish, true) : "no date"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Pay-app claims to query</h3>
      {flagged.length === 0 ? (
        <p>{checks.length ? `All ${checks.length} claims up to this flight are within ${site.overbill_pct}% of what the scans measured.` : "No claims entered."}</p>
      ) : (
        <ul>
          {flagged.map((c) => (
            <li key={c.payApp.id}>
              {formatDate(c.payApp.date)}: {c.payApp.contractor || "claim"} — {c.payApp.kind === "cut" ? "dug" : "filled"}{" "}
              {site.zones.find((z) => z.id === c.payApp.zone_id)?.name ?? "whole site"}: claimed {vol(c.payApp.claimed_m3)}, measured{" "}
              {vol(c.measured ?? 0)}
              {c.diffPct !== null && ` (${c.diffPct > 0 ? "+" : ""}${c.diffPct.toFixed(0)}%)`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function QuantitiesReport(props: SiteTabProps) {
  const layers = useLayers(props).filter((l) => l.measure);
  const piles = usePiles(props).piles.filter((p) => p.volume > 0);
  const ponds = usePonds(props).filter((p) => p.built);
  if (!layers.length && !piles.length && !ponds.length) return <p>No layers, stockpiles or ponds set up for this site.</p>;
  return (
    <>
      {layers.length > 0 && (
        <>
          <h3>Layers</h3>
          <ul>
            {layers.map(({ layer, measure: m }) => (
              <li key={layer.id}>
                <strong>{layer.name}</strong>: {area(m!.placedArea)} placed, {vol(m!.volume)}
                {m!.tonnes !== null && <> ({quantityText(formatTonnage(m!.tonnes))})</>}
                {m!.meanThickness !== null && <>, mean {formatThickness(m!.meanThickness)}</>} against {formatThickness(layer.target_thickness_m)}.{" "}
                {m!.thinArea > 0 ? (
                  <strong className="report-bad">
                    {area(m!.thinArea)} under {formatThickness(layer.target_thickness_m - layer.tolerance_m)}
                    {m!.thinnest !== null && <>, thinnest {formatThickness(m!.thinnest)}</>}.
                  </strong>
                ) : (
                  "Thick enough everywhere."
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {piles.length > 0 && (
        <>
          <h3>Stockpiles</h3>
          <ul>
            {piles.map((p) => (
              <li key={p.zone.id}>
                <strong>{p.zone.name}</strong>
                {p.material && ` (${p.material.label.toLowerCase()})`}: {vol(p.volume)}
                {p.tonnes !== null && <>, about {quantityText(formatTonnage(p.tonnes))}</>}
                {p.change !== null && Math.abs(p.change) >= 1 && <> — {p.change > 0 ? "up" : "down"} {vol(Math.abs(p.change))} since the last flight</>}.
              </li>
            ))}
          </ul>
        </>
      )}
      {ponds.length > 0 && (
        <>
          <h3>Pond storage</h3>
          <ul>
            {ponds.map((p) => (
              <li key={p.pond.zone_id}>
                <strong>{p.zone?.name ?? "Pond"}</strong>: holds {vol(p.built!.storage)} below the outlet
                {p.pctOfDesign !== null && <> — {p.pctOfDesign.toFixed(0)}% of the design</>}
                {p.stillToDig !== null && p.stillToDig > 1 && <>; {vol(p.stillToDig)} still to dig</>}.
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function ConditionsReport(props: SiteTabProps) {
  const c = conditionsSummary(props);
  if (!c) return <p>Site conditions haven't been worked out yet — open the Site conditions tab once, then print again.</p>;
  return (
    <ul>
      <li>
        Disturbed ground: <strong>{area(c.disturbed_m2)}</strong>
        {c.permit && " — over 1 acre: a stormwater (NPDES) permit applies"}.
      </li>
      {c.outside_m2 !== null && (
        <li className={c.outside_m2 > 0 ? "report-bad" : undefined}>
          {c.outside_m2 > 0 ? <strong>{area(c.outside_m2)} disturbed outside the limits of disturbance.</strong> : "Nothing disturbed outside the limits of disturbance."}
        </li>
      )}
      <li>
        Trees: about {c.trees} standing ({area(c.canopy_m2)} of canopy){c.cleared_m2 > 1 && <>; {area(c.cleared_m2)} cleared since the last flight</>}.
      </li>
      <li>Machines on site at flight time: {c.machines}.</li>
      {c.findings.length === 0 ? (
        <li>Storm check: nothing found since the last flight.</li>
      ) : (
        c.findings.map((f, i) => (
          <li key={i} className={f.repair ? "report-bad" : undefined}>
            {f.repair ? <strong>Repair:</strong> : "Watch:"} {f.text}
          </li>
        ))
      )}
      {c.thinPct > 5 && <li>Flight coverage: {c.thinPct.toFixed(0)}% of the site had thin ground coverage — volumes there are less certain.</li>}
    </ul>
  );
}


/** Checks & records: the same checks the tab runs (shared cache), as findings and trench records. */
export function ChecksReport({ siteId, site, surfaces, scan, reloadKey }: SiteTabProps) {
  const scanIds = site.scans.map((s) => s.project_id);
  const scanId = scanIds[scan] ?? null;
  const asbuilts = site.asbuilts ?? [];
  const flatwork = site.flatwork ?? [];
  const monitors = site.monitors ?? [];
  const trench = useChecks(siteId, "trench",
    asbuilts.map((a) => (scanIds.includes(a.scan) ? { scan: a.scan, line: a.line, diameter_m: parsePipeSize(a.note) ?? DEFAULT_PIPE_M } : null)), fetchTrench, reloadKey);
  const walks = useChecks(siteId, "flatwork",
    flatwork.map((f) => (scanId ? { scan: scanId, kind: f.kind, polygon: f.polygon } : null)), fetchFlatwork, reloadKey);
  const watch = useChecks(siteId, "monitor",
    monitors.map((m) => ({ polygon: m.polygon, baseline_scan: m.baseline_scan, alert_m: m.alert_m })), fetchMonitor, reloadKey);

  if (!asbuilts.length && !flatwork.length && !monitors.length)
    return <p>No trench records, walks or settlement areas set up for this site.</p>;
  const pending = [...trench, ...walks, ...watch].some((c) => c.loading);
  const findings: { item: string; f: Finding }[] = [];
  flatwork.forEach((w, i) => {
    const r = walks[i].data;
    r?.stretches?.forEach((s) => stretchFinding(s, r).forEach((f) => findings.push({ item: w.name, f })));
  });
  monitors.forEach((m, i) => {
    const r = watch[i].data;
    const k = r ? r.scans.indexOf(scanId ?? "") : -1;
    const f = r && k >= 0 ? monitorFinding(m.name, r.flights[k], m.alert_m) : null;
    if (f) findings.push({ item: m.name, f });
  });
  const shown = findings.filter((x) => x.f.level !== "info");

  return (
    <>
      {pending && <p>Some checks are still being worked out — wait a moment, then print.</p>}
      <h3>At {formatDate(surfaces.dates[scan])}</h3>
      {shown.length === 0 ? (
        <p>No walks too steep, no settlement past its alert.</p>
      ) : (
        <ul>
          {shown.map((x, i) => (
            <li key={i} className={x.f.level === "bad" ? "report-bad" : undefined}>
              <strong>{x.item}:</strong> {x.f.title}. {x.f.detail}
            </li>
          ))}
        </ul>
      )}
      {asbuilts.length > 0 && (
        <>
          <h3>Trench records</h3>
          <ul>
            {asbuilts.map((a, i) => {
              const r = trench[i].data;
              if (!r) return <li key={a.id}>{a.name}: {trench[i].error ?? "not worked out yet"}</li>;
              const flags = (r.flags ?? []).filter((fl) => fl.level !== "info").map(trenchFinding);
              return (
                <li key={a.id}>
                  <strong>{a.name}</strong> (flight of {formatDate(r.date)}):{" "}
                  {r.open ? (
                    <>
                      {formatLength(r.trench_length_m ?? r.length_m)} long, {formatLength(r.depth_mean_m ?? 0)} deep on average (up to{" "}
                      {formatLength(r.depth_max_m ?? 0)}){r.pipe?.seen && <>; pipe {pipeLabel(r.diameter_m)} {pipeFallText(r)}</>}.
                      {flags.map((f, k) => (
                        <span key={k} className={f.level === "bad" ? "report-bad" : undefined}>
                          {" "}
                          {f.title}.
                        </span>
                      ))}
                    </>
                  ) : (
                    "the trench wasn't open on that flight."
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
