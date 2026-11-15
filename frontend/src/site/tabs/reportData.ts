// Plain numbers for the site conditions section of the printable report, from
// the conditions the engine already worked out (cached once the tab has loaded).
import { formatArea, formatLength, formatVolume, quantityText } from "../../lib/units";
import { cellMask, outsideLimits, rillSeverity, zoneAt, needsStormwaterPermit } from "../conditions";
import { peekConditions } from "../conditionsApi";
import { zoneCells } from "../progress";
import type { SiteTabProps } from "./types";

export interface ConditionsSummary {
  disturbed_m2: number;
  permit: boolean;
  outside_m2: number | null; // null: no limits of disturbance drawn
  trees: number;
  canopy_m2: number;
  cleared_m2: number;
  machines: number;
  findings: { repair: boolean; text: string }[];
  thinPct: number;
}

export function conditionsSummary({ siteId, site, surfaces, scan }: SiteTabProps): ConditionsSummary | null {
  const c = peekConditions(siteId);
  const f = c?.flights[scan];
  if (!c || !f || c.nx !== surfaces.nx || c.ny !== surfaces.ny) return null;
  const lod = site.lod ? cellMask(zoneCells(surfaces, site.lod), c.nx * c.ny) : null;
  const out = lod ? outsideLimits(c.marks[scan], lod, c.cell * c.cell) : null;
  const findings = scan === 0 ? [] : [
    ...f.storm.rills.map((r) => ({
      repair: rillSeverity(r) === "repair",
      text: `erosion rill ${formatLength(r.length_m)} long, up to ${formatLength(r.depth_m)} deep (about ${quantityText(formatVolume(r.volume_m3))}), ${zoneAt(site, r.e, r.n) ?? "outside the work zones"}`,
    })),
    ...f.storm.water.map((w) => ({
      repair: false,
      text: `no laser return over ${quantityText(formatArea(w.area_m2))} — possibly standing water, ${zoneAt(site, w.e, w.n) ?? "outside the work zones"}`,
    })),
  ].sort((a, b) => Number(b.repair) - Number(a.repair));
  const covered = f.coverage.covered_m2 || 1;
  return {
    disturbed_m2: f.disturbed.total_m2,
    permit: needsStormwaterPermit(f.disturbed.total_m2),
    outside_m2: out ? out.outside_m2 : null,
    trees: f.vegetation.trees,
    canopy_m2: f.vegetation.canopy_m2,
    cleared_m2: f.cleared_since_previous_m2,
    machines: f.machines.length,
    findings,
    thinPct: (100 * f.coverage.thin_m2) / covered,
  };
}
