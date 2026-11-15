import { formatOffset, GRADE_LABEL } from "../control/qa";
import { formatLength } from "../lib/units";
import { formatDate, todayIso } from "./dates";
import type { FlightVerdict } from "./FlightTimeline";
import { SITE_TABS } from "./tabs/registry";
import type { SiteTabProps } from "./tabs/types";

interface SiteReportProps {
  tab: SiteTabProps; // the same inputs the dashboard's tabs get, at the flight picked on the timeline
  verdict: FlightVerdict | null; // that flight's accuracy against the check points
  designName: string | null;
  onClose: () => void;
}

/**
 * A printable one-flight report of a job site: what every tab would tell you,
 * as sentences and small tables. "Print / save as PDF" uses the system print
 * dialog (choose "Microsoft Print to PDF" / "Save as PDF").
 */
export function SiteReport({ tab, verdict, designName, onClose }: SiteReportProps) {
  const { site, surfaces, scan } = tab;
  const flight = surfaces.dates[scan];
  const sections = SITE_TABS.filter((t) => t.report);
  return (
    <div className="site-report">
      <div className="report-toolbar">
        <button className="secondary-btn" onClick={onClose}>
          ← Back to the dashboard
        </button>
        <span className="report-toolbar-note">Report for the flight of {formatDate(flight)} — pick another flight on the dashboard's timeline first.</span>
        <button className="primary-btn compact" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>

      <article className="report-page">
        <header className="report-head">
          <div>
            <h1>{site.name}</h1>
            <p>
              Site progress report · flight of <strong>{formatDate(flight)}</strong>
              {scan > 0 && <> (previous {formatDate(surfaces.dates[scan - 1])})</>}
            </p>
          </div>
          <dl>
            <dt>Design</dt>
            <dd>{designName ?? "none"}</dd>
            <dt>Flight accuracy</dt>
            <dd>
              {verdict && verdict.grade !== "none"
                ? `${GRADE_LABEL[verdict.grade]} — ±${formatOffset(verdict.rmse ?? 0, false)}${verdict.bias !== null ? `, offset ${formatOffset(verdict.bias)}` : ""}`
                : "not checked (no check points)"}
            </dd>
            <dt>Printed</dt>
            <dd>{formatDate(todayIso())}</dd>
          </dl>
        </header>

        {verdict?.bias != null && (
          <p className="report-warning">
            This flight sits {formatOffset(Math.abs(verdict.bias), false)} {verdict.bias > 0 ? "high" : "low"} against the check points. Correct it
            (Control &amp; accuracy) before relying on the volumes below.
          </p>
        )}

        {sections.map((t) => {
          const Section = t.report!;
          return (
            <section key={t.id} className="report-section">
              <h2>{t.label}</h2>
              <Section {...tab} />
            </section>
          );
        })}

        <footer className="report-foot">
          Measured by Surveyr from drone / rover LiDAR. Volumes are prismatic cells on a {formatLength(surfaces.cell)} grid over scanned
          ground only; drone LiDAR is typically ±{formatOffset(0.02, false)}–{formatOffset(0.05, false)} vertically. Decision support, not a stamped survey.
        </footer>
      </article>
    </div>
  );
}
