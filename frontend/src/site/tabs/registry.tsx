// The tabs of the job-site dashboard, in display order. A feature that belongs
// to a job site adds one component under site/tabs/ and one entry here.
import { ChangeOrderLog } from "../ChangeOrderLog";
import { ChecksTab } from "./ChecksTab";
import { conditionsCount, ConditionsTab } from "./ConditionsTab";
import { ProgressTab } from "./ProgressTab";
import { QuantitiesTab } from "./QuantitiesTab";
import { ChecksReport, ConditionsReport, ProgressReport, QuantitiesReport } from "./reports";
import type { SiteTabDef, SiteTabProps } from "./types";

function ChangesTab({ site, projects, state, onNewChangeOrder }: SiteTabProps) {
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  return <ChangeOrderLog site={site} nameOf={nameOf} onUpdate={state.update} onNew={onNewChangeOrder} />;
}

export const SITE_TABS: SiteTabDef[] = [
  {
    id: "progress",
    label: "Progress",
    hint: "How far along the earthworks are, zone by zone, against the plan and the contractor's claims.",
    Component: ProgressTab,
    report: ProgressReport,
  },
  {
    id: "quantities",
    label: "Quantities",
    hint: "How much base and paving went down and whether it's thick enough, what's in each stockpile, and whether the pond holds what the design says.",
    Component: QuantitiesTab,
    report: QuantitiesReport,
  },
  {
    id: "conditions",
    label: "Site conditions",
    hint: "What the flight shows besides earthworks: the site from above, trees and machines, disturbed ground and the limits, storm damage.",
    Component: ConditionsTab,
    report: ConditionsReport,
    count: conditionsCount,
    alert: (p) => (conditionsCount(p) ?? 0) > 0,
  },
  {
    id: "checks",
    label: "Checks & records",
    hint: "Trenches, walks and fills checked before the inspector does, and a permanent record of what gets buried.",
    Component: ChecksTab,
    report: ChecksReport,
    count: ({ site }) => (site.asbuilts?.length ?? 0) + (site.flatwork?.length ?? 0) + (site.monitors?.length ?? 0) + (site.alignments?.length ?? 0) || null,
  },
  {
    id: "changes",
    label: "Change orders",
    hint: "Every revision of the job's specs — design, tolerance, grades and dates — as a permanent log.",
    Component: ChangesTab,
    count: ({ site }) => site.change_orders?.length || null,
    timeline: false,
  },
];
