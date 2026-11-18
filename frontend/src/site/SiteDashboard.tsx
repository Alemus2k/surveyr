import { useState } from "react";
import type { ProjectRef } from "../api";
import { formatOffset, gradeAccuracy } from "../control/qa";
import { ChangeOrderDialog } from "./ChangeOrderDialog";
import { formatDate } from "./dates";
import { FlightTimeline, type FlightVerdict } from "./FlightTimeline";
import { SiteReport } from "./SiteReport";
import { siteSummary } from "./summary";
import { SITE_TABS } from "./tabs/registry";
import type { ScanCloud, SiteTabProps } from "./tabs/types";
import type { SiteState } from "./useSite";

export type { ScanCloud } from "./tabs/types";

interface SiteDashboardProps {
  siteId: string;
  state: SiteState;
  projects: ProjectRef[];
  scanId: string | null; // the scan shown; null = latest
  onScan: (projectId: string | null) => void;
  scanCloud: ScanCloud | null;
  accent: string; // 3D viewport highlight
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
  onZoneCreated: (id: string) => void;
  onReviewFlight: (projectId: string) => void; // show a flight in Control & accuracy
  reloadKey: number;
}

/**
 * A job site: the frame every tab shares (title, flight warnings, tab bar,
 * flight timeline) around the tab picked. Tabs live in ./tabs/registry.tsx.
 */
export function SiteDashboard(props: SiteDashboardProps) {
  const { siteId, state, projects, scanId, onScan, onReviewFlight } = props;
  const { site, surfaces, progress, checks, update } = state;
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [tabId, setTab] = useState(SITE_TABS[0].id);
  const [ordering, setOrdering] = useState(false); // change-order dialog open
  const [printing, setPrinting] = useState(false); // the printable report replaces the dashboard

  if (!site) return <div className="empty-state">Loading site…</div>;
  if (site.scans.length === 0)
    return <div className="empty-state">This site has no scans left — add scans from the Site setup panel.</div>;
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
  const name = (id: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? id : null);
  // each flight graded against the site's check points; flag offsets and poor fits
  const verdicts = new Map<string, FlightVerdict>(
    state.qa.map((q) => [q.project_id, { ...gradeAccuracy(q.stats, site.tolerance_m), rmse: q.stats.rmse }])
  );
  const suspect = site.scans.filter((s) => {
    const v = verdicts.get(s.project_id);
    return v && (v.bias !== null || v.grade === "poor");
  });

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(siteSummary(site.name, progress, checks, site.overbill_pct));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };

  const tab = SITE_TABS.find((t) => t.id === tabId) ?? SITE_TABS[0];
  const tabProps: SiteTabProps = {
    siteId,
    site,
    surfaces,
    state,
    projects,
    scan,
    onScan,
    scanCloud: props.scanCloud,
    accent: props.accent,
    selectedZone: props.selectedZone,
    onSelectZone: props.onSelectZone,
    onZoneCreated: props.onZoneCreated,
    onReviewFlight,
    onNewChangeOrder: () => setOrdering(true),
    openTab: setTab,
    reloadKey: props.reloadKey,
  };

  if (printing)
    return (
      <SiteReport
        tab={tabProps}
        verdict={verdicts.get(site.scans[scan]?.project_id ?? "") ?? null}
        designName={name(site.design_id)}
        onClose={() => setPrinting(false)}
      />
    );

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
        <div className="site-head-actions">
          <button className="secondary-btn" onClick={() => setOrdering(true)}>
            Job specs change order
          </button>
          <button className="secondary-btn" onClick={() => setPrinting(true)} title="A one-flight report to print or save as PDF">
            Print report
          </button>
          <button className="secondary-btn" onClick={copySummary}>
            {copied === "done" ? "Copied to clipboard" : copied === "failed" ? "Couldn't copy" : "Copy progress summary"}
          </button>
        </div>
      </header>

      <div className="site-tabs" role="tablist" aria-label="Site views">
        {SITE_TABS.map((t) => {
          const count = t.count?.(tabProps) ?? null;
          return (
            <button key={t.id} role="tab" aria-selected={t.id === tab.id} title={t.hint} onClick={() => setTab(t.id)}>
              {t.label}
              {count !== null && <span className={`tab-count fig${t.alert?.(tabProps) ? " alert" : ""}`}>{count}</span>}
            </button>
          );
        })}
      </div>
      <p className="site-tab-hint">{tab.hint}</p>

      {suspect.map((s) => {
        const v = verdicts.get(s.project_id)!;
        return (
          <div key={s.project_id} className="qa-banner" role="status">
            <span>
              <strong>{formatDate(s.date)} flight</strong>{" "}
              {v.bias !== null
                ? `sits ${formatOffset(Math.abs(v.bias), false)} ${v.bias > 0 ? "high" : "low"} against the check points`
                : `fits the check points poorly (RMSE ${formatOffset(v.rmse ?? 0, false)})`}
              {" "}— volumes involving it will be off until it's corrected.
            </span>
            <button className="secondary-btn" onClick={() => onReviewFlight(s.project_id)}>
              Review flight
            </button>
          </div>
        );
      })}

      {tab.timeline !== false && <FlightTimeline scans={site.scans} scan={scan} verdicts={verdicts} onScan={onScan} />}

      <tab.Component {...tabProps} />

      {state.saveError && <p className="error-state">{state.saveError}</p>}
      <ChangeOrderDialog
        open={ordering}
        site={site}
        surfaces={surfaces}
        cellsOf={state.cellsOf}
        projects={projects}
        onIssue={(change) => {
          update(change);
          setOrdering(false);
          setTab("changes");
        }}
        onCancel={() => setOrdering(false)}
      />
    </div>
  );
}
