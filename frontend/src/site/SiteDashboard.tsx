import { useState } from "react";
import type { ProjectRef } from "../api";
import type { ColorRange, PreparedCloud } from "../viewer/prepare";
import { Icon } from "../layout/icons";
import { formatVolume } from "../lib/format";
import { formatDate, todayIso } from "./dates";
import { PayAppCard } from "./PayAppCard";
import { overallPct } from "./progress";
import { ProgressChart } from "./ProgressChart";
import { Site3D } from "./Site3D";
import { SiteMap, type MapMode } from "./SiteMap";
import { siteSummary } from "./summary";
import { ZONE_PALETTE } from "./types";
import type { SiteState } from "./useSite";
import { ZoneTable } from "./ZoneTable";

/** The selected scan's points for the 3D view (loaded by the app, which also feeds the scan panels). */
export interface ScanCloud {
  projectId: string;
  cloud: PreparedCloud;
  colors: Float32Array; // elevation colours from the Cloud colour panel
  range: ColorRange;
}

interface SiteDashboardProps {
  state: SiteState;
  projects: ProjectRef[];
  scanId: string | null; // the scan shown; null = latest
  onScan: (projectId: string | null) => void;
  scanCloud: ScanCloud | null;
  accent: string; // 3D viewport highlight
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
  onZoneCreated: (id: string) => void;
}

const MODES: ReadonlyArray<[MapMode, string]> = [
  ["design", "vs design"],
  ["change", "Since last scan"],
  ["elevation", "Elevation"],
];

/** Construction progress for a job site: timeline, plan map, zones, schedule and pay apps. */
export function SiteDashboard(props: SiteDashboardProps) {
  const { state, projects, scanId, onScan, scanCloud, accent, selectedZone, onSelectZone, onZoneCreated } = props;
  const { site, surfaces, progress, checks, update } = state;
  const [modeChoice, setMode] = useState<MapMode>("design");
  const [view, setView] = useState<"plan" | "3d">("plan");
  const [drawing, setDrawing] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const today = todayIso();

  if (!site) return <div className="empty-state">Loading site…</div>;
  if (site.scans.length === 0)
    return <div className="empty-state">This site has no scans left — add scans from the Site panel.</div>;
  if (!surfaces)
    return (
      <div className="empty-state">
        <span className="spinner" aria-hidden="true" />
        Building site surfaces from {site.scans.length} scans…
      </div>
    );

  const last = surfaces.scans.length - 1;
  const chosen = scanId ? site.scans.findIndex((s) => s.project_id === scanId) : -1;
  const scan = chosen >= 0 && chosen <= last ? chosen : last;
  const mode: MapMode = modeChoice === "design" && !surfaces.design ? "change" : modeChoice === "change" && scan === 0 ? (surfaces.design ? "design" : "elevation") : modeChoice;
  const name = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? id : null);
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

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(siteSummary(site.name, progress, checks, site.overbill_pct));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };

  return (
    <div className="site-dash">
      <header className="site-head">
        <div className="site-title">
          <h1>{site.name}</h1>
          <p>
            {surfaces.scans.length} scans · {formatDate(surfaces.dates[0])} → {formatDate(surfaces.dates[last])} · design:{" "}
            {name(site.design_id) ?? "none"}
            {state.loading && <span className="site-refresh"> · updating…</span>}
          </p>
        </div>
        <button className="secondary-btn" onClick={copySummary}>
          {copied === "done" ? "Copied to clipboard" : copied === "failed" ? "Couldn't copy" : "Copy progress summary"}
        </button>
      </header>

      <div className="site-kpis">
        <div className="kpi">
          <span className="kpi-label">Earthworks complete</span>
          <strong className="mono">{overall === null ? "—" : `${overall.toFixed(0)}%`}</strong>
          <span className="kpi-sub">all grading zones, by volume</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Moved last period</span>
          <strong className="mono">{last > 0 ? `${formatVolume(movedLatest).value} m³` : "—"}</strong>
          <span className="kpi-sub">{last > 0 ? `${formatDate(surfaces.dates[last - 1], true)} → ${formatDate(surfaces.dates[last], true)}, in zones` : "one scan so far"}</span>
        </div>
        <div className={`kpi ${behind.length ? "bad" : ""}`}>
          <span className="kpi-label">Zones behind plan</span>
          <strong className="mono">{behind.length}</strong>
          <span className="kpi-sub">{behind.length ? behind.map((p) => p.zone.name).join(", ") : `of ${grading.length} grading zones`}</span>
        </div>
        <div className={`kpi ${flagged.length ? "bad" : ""}`}>
          <span className="kpi-label">Pay-app claims to query</span>
          <strong className="mono">{flagged.length}</strong>
          <span className="kpi-sub">{checks.length ? `of ${checks.length} checked against the scans` : "no claims entered"}</span>
        </div>
      </div>

      <nav className="site-timeline" aria-label="Scans">
        {surfaces.dates.map((d, k) => (
          <button key={d + k} aria-pressed={k === scan} onClick={() => onScan(k === last ? null : site.scans[k].project_id)}>
            <span className="mono">{formatDate(d, true)}</span>
            <span className="tl-sub">{k === 0 ? "first scan" : k === last ? "latest" : `scan ${k + 1}`}</span>
          </button>
        ))}
      </nav>

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
            />
          )}
          <MapLegend mode={mode} tolerance={site.tolerance_m} threshold={site.change_threshold_m} />
        </section>

        <section className="site-card">
          <h3>
            Zones <span className="site-card-note">at {formatDate(surfaces.dates[scan])}</span>
          </h3>
          <ZoneTable progress={progress} scan={scan} selected={selectedZone} onSelect={onSelectZone} />
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
      {state.saveError && <p className="error-state">{state.saveError}</p>}
    </div>
  );
}

function MapLegend({ mode, tolerance, threshold }: { mode: MapMode; tolerance: number; threshold: number }) {
  const cm = (m: number) => `${Math.round(m * 100)} cm`;
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
          <i className="sw ok" /> finished to grade (±{cm(tolerance)})
        </span>
      )}
      <span>
        <i className="sw fill" /> {mode === "design" ? "below design — still to fill" : "placed since last scan"}
      </span>
      {mode === "change" && <span className="site-legend-note">changes under {cm(threshold)} ignored</span>}
    </div>
  );
}
