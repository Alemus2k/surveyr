import { useState } from "react";
import { ConfirmDialog } from "../../layout/ConfirmDialog";
import { Icon } from "../../layout/icons";
import { formatSmall, formatVolume, quantityText } from "../../lib/units";
import { formatDate, todayIso } from "../dates";
import { PayAppCard } from "../PayAppCard";
import { overallPct } from "../progress";
import { ProgressChart } from "../ProgressChart";
import { Site3D } from "../Site3D";
import { SiteMap, type MapMode } from "../SiteMap";
import { ZONE_PALETTE } from "../types";
import { ZoneTable } from "../ZoneTable";
import type { SiteTabProps } from "./types";

const MODES: ReadonlyArray<[MapMode, string]> = [
  ["design", "vs design"],
  ["change", "Since last scan"],
  ["elevation", "Elevation"],
];

/** Earthworks progress: headline numbers, plan / 3D map, zones, schedule and pay-app check. */
export function ProgressTab(props: SiteTabProps) {
  const { site, surfaces, state, scan, scanCloud, accent, selectedZone, onSelectZone, onZoneCreated } = props;
  const { progress, checks, update } = state;
  const [modeChoice, setMode] = useState<MapMode>("design");
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [drawing, setDrawing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null); // zone awaiting confirmation
  const today = todayIso();

  const last = surfaces.scans.length - 1;
  const mode: MapMode = modeChoice === "design" && !surfaces.design ? "change" : modeChoice === "change" && scan === 0 ? (surfaces.design ? "design" : "elevation") : modeChoice;
  const grading = progress.filter((p) => p.zone.kind === "grading");
  const overall = overallPct(progress);
  const movedLatest = progress.reduce((sum, p) => sum + (p.snapshots[last]?.cut ?? 0) + (p.snapshots[last]?.fill ?? 0), 0);
  const behind = grading.filter((p) => p.status === "behind" || p.status === "stalled");
  const flagged = checks.filter((c) => c.flagged);

  const zoneDrawn = (polygon: [number, number][]) => {
    setDrawing(false);
    const id = `z${Date.now().toString(36)}`;
    update((s) => ({
      ...s,
      zones: [
        ...s.zones,
        {
          id,
          name: `Zone ${s.zones.length + 1}`,
          kind: "grading",
          color: ZONE_PALETTE[s.zones.length % ZONE_PALETTE.length],
          polygon,
          start: null,
          finish: null,
        },
      ],
    }));
    onSelectZone(id);
    onZoneCreated(id);
  };

  const deletingZone = site.zones.find((z) => z.id === deleting) ?? null;
  const confirmDelete = () => {
    if (!deletingZone) return;
    update((s) => ({
      ...s,
      zones: s.zones.filter((z) => z.id !== deletingZone.id),
      // claims against the zone stay, measured against the whole site
      pay_apps: s.pay_apps.map((p) => (p.zone_id === deletingZone.id ? { ...p, zone_id: null } : p)),
    }));
    if (selectedZone === deletingZone.id) onSelectZone(null);
    setDeleting(null);
  };
  const claimsOnDeleting = deletingZone ? site.pay_apps.filter((p) => p.zone_id === deletingZone.id).length : 0;

  return (
    <>
      <div className="site-kpis">
        <div className="kpi">
          <span className="kpi-label">Earthworks complete</span>
          <strong className="fig">{overall === null ? "—" : `${overall.toFixed(0)}%`}</strong>
          <span className="kpi-sub">all grading zones, by volume</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Moved last period</span>
          <strong className="fig">{last > 0 ? quantityText(formatVolume(movedLatest)) : "—"}</strong>
          <span className="kpi-sub">{last > 0 ? `${formatDate(surfaces.dates[last - 1], true)} → ${formatDate(surfaces.dates[last], true)}, in zones` : "one scan so far"}</span>
        </div>
        <div className={`kpi ${behind.length ? "bad" : ""}`}>
          <span className="kpi-label">Zones behind plan</span>
          <strong className="fig">{behind.length}</strong>
          <span className="kpi-sub">{behind.length ? behind.map((p) => p.zone.name).join(", ") : `of ${grading.length} grading zones`}</span>
        </div>
        <div className={`kpi ${flagged.length ? "bad" : ""}`}>
          <span className="kpi-label">Pay-app claims to query</span>
          <strong className="fig">{flagged.length}</strong>
          <span className="kpi-sub">{checks.length ? `of ${checks.length} checked against the scans` : "no claims entered"}</span>
        </div>
      </div>

      <div className="site-grid">
        <section className="site-card site-map-card">
          <div className="site-card-head">
            <div className="segmented" role="group" aria-label="Map colouring">
              {MODES.map(([m, label]) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  disabled={(m === "design" && !surfaces.design) || (m === "change" && scan === 0)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="site-card-tools">
              <div className="segmented" role="group" aria-label="View">
                <button aria-pressed={view === "plan"} onClick={() => setView("plan")}>
                  Plan
                </button>
                <button
                  aria-pressed={view === "3d"}
                  onClick={() => {
                    setView("3d");
                    setDrawing(false);
                  }}
                >
                  3D
                </button>
              </div>
              {view === "plan" && (
                <button className={drawing ? "primary-btn compact" : "secondary-btn"} onClick={() => setDrawing((d) => !d)}>
                  <Icon name="plus" size={14} /> {drawing ? "Drawing…" : "Draw zone"}
                </button>
              )}
            </div>
          </div>
          {view === "3d" ? (
            scanCloud && scanCloud.projectId === site.scans[scan]?.project_id ? (
              <Site3D
                cloud={scanCloud.cloud}
                elevationColors={scanCloud.colors}
                range={scanCloud.range}
                surfaces={surfaces}
                scan={scan}
                mode={mode}
                tolerance={site.tolerance_m}
                changeThreshold={site.change_threshold_m}
                zones={site.zones}
                selectedZone={selectedZone}
                accent={accent}
                highest={scanCloud.highest}
              />
            ) : (
              <div className="site-3d site-3d-loading">
                <span className="spinner" aria-hidden="true" /> Loading the scan's points…
              </div>
            )
          ) : (
            <SiteMap
              surfaces={surfaces}
              scan={scan}
              mode={mode}
              tolerance={site.tolerance_m}
              changeThreshold={site.change_threshold_m}
              zones={site.zones}
              selectedZone={selectedZone}
              onSelectZone={onSelectZone}
              drawing={drawing}
              onDrawn={zoneDrawn}
              onDrawCancel={() => setDrawing(false)}
              onDeleteZone={setDeleting}
            />
          )}
          <MapLegend mode={mode} tolerance={site.tolerance_m} threshold={site.change_threshold_m} />
        </section>

        <section className="site-card">
          <h3>
            Zones <span className="site-card-note">at {formatDate(surfaces.dates[scan])}</span>
          </h3>
          <ZoneTable progress={progress} scan={scan} selected={selectedZone} onSelect={onSelectZone} onDelete={setDeleting} />
        </section>

        <section className="site-card wide">
          <h3>Progress against plan</h3>
          <ProgressChart progress={grading} selected={selectedZone} today={today} onSelect={onSelectZone} />
        </section>

        <section className="site-card wide">
          <h3>Pay-app check</h3>
          <PayAppCard
            checks={checks}
            zones={site.zones}
            periodEnds={surfaces.dates.slice(1)}
            overbillPct={site.overbill_pct}
            onAdd={(pa) => update((s) => ({ ...s, pay_apps: [...s.pay_apps, pa] }))}
            onRemove={(id) => update((s) => ({ ...s, pay_apps: s.pay_apps.filter((p) => p.id !== id) }))}
          />
        </section>
      </div>

      <ConfirmDialog
        open={deletingZone !== null}
        title={`Delete “${deletingZone?.name ?? ""}”?`}
        confirmLabel="Delete zone"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        <p>
          The zone's outline and planned dates are removed. The scans aren't affected.
          {claimsOnDeleting > 0 &&
            ` Its ${claimsOnDeleting} pay-app claim${claimsOnDeleting === 1 ? "" : "s"} will be measured against the whole site instead.`}
        </p>
      </ConfirmDialog>
    </>
  );
}

function MapLegend({ mode, tolerance, threshold }: { mode: MapMode; tolerance: number; threshold: number }) {
  const small = (m: number) => formatSmall(m, { style: "whole" });
  if (mode === "elevation")
    return (
      <div className="site-legend">
        <span>low</span>
        <i className="site-legend-ramp" />
        <span>high</span>
        <span className="site-legend-note">shaded relief, north up</span>
      </div>
    );
  return (
    <div className="site-legend">
      <span>
        <i className="sw cut" /> {mode === "design" ? "above design — still to dig" : "dug since last scan"}
      </span>
      {mode === "design" && (
        <span>
          <i className="sw ok" /> finished to grade (±{small(tolerance)})
        </span>
      )}
      <span>
        <i className="sw fill" /> {mode === "design" ? "below design — still to fill" : "placed since last scan"}
      </span>
      {mode === "change" && <span className="site-legend-note">changes under {small(threshold)} ignored</span>}
    </div>
  );
}
