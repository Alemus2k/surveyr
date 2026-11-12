// The tabs of the job-site dashboard, in display order. A feature that belongs
// to a job site adds one component under site/tabs/ and one entry here.
import { ChangeOrderLog } from "../ChangeOrderLog";
import { ProgressTab } from "./ProgressTab";
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
