import type { ComponentType } from "react";
import type { ProjectRef } from "../../api";
import type { ColorRange, PreparedCloud } from "../../viewer/prepare";
import type { Surfaces } from "../progress";
import type { Site } from "../types";
import type { SiteState } from "../useSite";

/** The selected scan's points for 3D views (loaded by the app, which also feeds the scan panels). */
export interface ScanCloud {
  projectId: string;
  cloud: PreparedCloud;
  colors: Float32Array; // elevation colours from the Cloud colour panel
  range: ColorRange;
  highest: number | null; // highest ground cell, as in the Terrain panel
}

/** Everything a job-site tab gets. The site and its surfaces are loaded before any tab renders. */
export interface SiteTabProps {
  siteId: string;
  site: Site;
  surfaces: Surfaces; // every flight (and the finished grade) on the shared grid
  state: SiteState; // progress, pay-app checks, flight QA, update()
  projects: ProjectRef[];
  scan: number; // the flight picked in the timeline (index into site.scans / surfaces.scans)
  onScan: (projectId: string | null) => void; // null = latest
  scanCloud: ScanCloud | null; // that flight's points, once loaded
  accent: string; // 3D viewport highlight
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
  onZoneCreated: (id: string) => void;
  onReviewFlight: (projectId: string) => void; // show a flight in Control & accuracy
  onNewChangeOrder: () => void;
  openTab: (id: string) => void; // switch to another tab of the dashboard
  reloadKey: number; // bumps when a scan's settings change: refetch anything derived from points
}

/** One tab of the job-site dashboard. Add yours in ./registry.tsx. */
export interface SiteTabDef {
  id: string;
  label: string;
  hint: string; // one plain sentence: what question this tab answers (shown under the tab bar)
  Component: ComponentType<SiteTabProps>;
  count?: (p: SiteTabProps) => number | null; // small number on the tab (items, or things needing a look)
  alert?: (p: SiteTabProps) => boolean; // draw the count in the warning colour
  timeline?: boolean; // false for tabs that aren't about one flight (default true)
  report?: ComponentType<SiteTabProps>; // this tab's section of the printable site report (sentences and small tables)
}
