import { useState } from "react";
import type { ProjectRef } from "../api";
import { loadPref, savePref } from "../lib/persist";
import { setUnitSystem, useUnitSystem, type UnitSystem } from "../lib/units";
import { Icon } from "./icons";
import { ImportScanButton } from "./ImportScanButton";

interface GettingStartedProps {
  projects: ProjectRef[];
  onOpen: (id: string) => void;
  onImport: (file: File) => void;
  onNewSite: () => void;
  onRestoreDemo: () => void;
  busy: boolean;
  onClose?: () => void; // shown over an open project: a way back
}

const DEMO_SITE = "riverside_commons";
const UNITS_CHOSEN = "surveyr.unitsChosen";
const UNIT_CHOICES: ReadonlyArray<[UnitSystem, string, string]> = [
  ["us", "US", "feet, cubic yards, acres"],
  ["metric", "Metric", "metres, cubic metres, hectares"],
];
const isTrue = (v: unknown): v is boolean => v === true;

/**
 * The first thing a new user sees, and the "?" page later: what Surveyr does,
 * three ways in, and how the pieces fit together.
 */
export function GettingStarted({ projects, onOpen, onImport, onNewSite, onRestoreDemo, busy, onClose }: GettingStartedProps) {
  const units = useUnitSystem();
  const [unitsChosen, setUnitsChosen] = useState(() => loadPref(UNITS_CHOSEN, isTrue) === true);
  const demo = projects.find((p) => p.id === DEMO_SITE);
  const sites = projects.filter((p) => p.type === "site");
  const scans = projects.filter((p) => p.type !== "site" && p.type !== "compare");
  const chooseUnits = (u: UnitSystem) => {
    setUnitSystem(u);
    savePref(UNITS_CHOSEN, true);
    setUnitsChosen(true);
  };

  return (
    <div className="welcome">
      <header className="welcome-head">
        <div>
          <h1>Welcome to Surveyr</h1>
          <p>
            Turn drone or rover LiDAR flights of your job sites into earthwork quantities, progress against plan, pay-app
            checks and site records — on this computer, no accounts or internet needed.
          </p>
        </div>
        {onClose && (
          <button className="tool-btn" onClick={onClose} aria-label="Close getting started" title="Close">
            <Icon name="close" size={16} />
          </button>
        )}
      </header>

      {!unitsChosen && (
        <section className="welcome-units" aria-label="Units">
          <span>Show measurements in</span>
          <div className="segmented" role="group" aria-label="Units">
            {UNIT_CHOICES.map(([value, label, detail]) => (
              <button key={value} aria-pressed={units === value} onClick={() => chooseUnits(value)} title={detail}>
                {label} <span className="welcome-units-detail">({detail})</span>
              </button>
            ))}
          </div>
          <span className="welcome-units-note">You can change this later under Appearance (palette icon, top right).</span>
        </section>
      )}

      <div className="welcome-cards">
        <article className="welcome-card">
          <span className="welcome-step">1</span>
          <h2>Explore the demo site</h2>
          <p>
            Riverside Commons: eight flights over fourteen weeks of a pad, parking lot, pond and road being built — with
            a bad flight, an over-billed pay app and a trench to find.
          </p>
          {demo ? (
            <button className="primary-btn" onClick={() => onOpen(demo.id)}>
              Open Riverside Commons
            </button>
          ) : (
            <button className="secondary-btn" onClick={onRestoreDemo} disabled={busy}>
              Install the demo site
            </button>
          )}
        </article>

        <article className="welcome-card">
          <span className="welcome-step">2</span>
          <h2>Import a scan</h2>
          <p>
            A LiDAR flight (<span className="fig">.las</span> / <span className="fig">.laz</span>), a phone scan (
            <span className="fig">.ply</span>) or the engineer's design (LandXML <span className="fig">.xml</span>). It
            opens in 3D with terrain, slopes and volumes.
          </p>
          <ImportScanButton onFile={onImport} busy={busy} className="primary-btn" label="Import scan">
            {busy ? "Working…" : "Choose a file…"}
          </ImportScanButton>
        </article>

        <article className="welcome-card">
          <span className="welcome-step">3</span>
          <h2>Track a job site</h2>
          <p>
            Put a site's flights in date order with its design, draw the work areas, and Surveyr measures progress,
            checks claims and keeps a record after every flight.
          </p>
          <button className="primary-btn" onClick={onNewSite} disabled={scans.length === 0}>
            New job site…
          </button>
          {scans.length === 0 && <p className="welcome-note">Import at least one scan first.</p>}
        </article>
      </div>

      <section className="welcome-how" aria-label="How it fits together">
        <h2>How it fits together</h2>
        <ol>
          <li>
            <strong>Scans</strong> are files you import — each flight, and the design surface. They live under{" "}
            <Icon name="folder" size={14} /> <em>Projects</em> and are never changed by Surveyr.
          </li>
          <li>
            A <strong>job site</strong> groups one site's flights by date with its design. Find it under{" "}
            <Icon name="hardhat" size={14} /> <em>Job sites</em>; edit it in <Icon name="flag" size={14} />{" "}
            <em>Site setup</em>.
          </li>
          <li>
            The site opens as a <strong>dashboard</strong>: pick a flight on the timeline, then a tab — progress,
            quantities, site conditions, checks &amp; records, change orders.
          </li>
          <li>
            The icons down the left side are <strong>tools for the scan in view</strong> (terrain, colours, maps,
            charts, earthworks, accuracy, adjustments). Hover any icon for its name.
          </li>
        </ol>
        {(sites.length > 0 || scans.length > 0) && (
          <p className="welcome-note">
            You have {sites.length} job site{sites.length === 1 ? "" : "s"} and {scans.length} scan
            {scans.length === 1 ? "" : "s"}. Open one from the left, or press <strong>?</strong> in the top bar to come
            back here.
          </p>
        )}
      </section>
    </div>
  );
}
