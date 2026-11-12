import { formatArea, formatCapacity, formatDistance, formatElevation, formatLength, formatVolume, quantityText } from "../lib/units";
import type { Haul, Volumes } from "./earthworks";

export interface SummaryInput {
  project: string;
  padElevation: number;
  balanced: boolean;
  slopePct: number;
  fallsToward: string;
  scannedArea: number;
  cellSize: number;
  volumes: Volumes;
  material: { label: string; swellPct: number; shrinkPct: number };
  haul: Haul;
  truckM3: number;
}

const vol = (m3: number) => quantityText(formatVolume(m3));
const area = (m2: number) => quantityText(formatArea(m2));

/** Plain-text earthworks summary for pasting into an email or quote. */
export function jobsiteSummary(s: SummaryInput): string {
  const pad = `${s.balanced ? "Balanced pad" : "Pad"} at ${formatElevation(s.padElevation)}`;
  const fall = s.slopePct > 0 ? `, falling ${s.slopePct}% toward ${s.fallsToward}` : " (level)";
  const { haul: h, volumes: v } = s;
  const outcome =
    h.direction === "balanced"
      ? "Balanced on site — no import or export."
      : `${h.direction === "export" ? "Export" : "Import"} ${vol(h.loose)} loose (${vol(h.bank)} in the ground) ≈ ${h.loads.toLocaleString("en-GB")} loads of ${formatCapacity(s.truckM3)}.`;
  return [
    `Surveyr — job site earthworks: ${s.project}`,
    `${pad}${fall}`,
    `Scanned area: ${area(s.scannedArea)} (grid ${formatDistance(s.cellSize)})`,
    `Cut: ${vol(v.cut)} in place over ${area(v.cutArea)}, deepest ${formatLength(v.maxCut)}`,
    `Fill: ${vol(v.fill)} compacted over ${area(v.fillArea)}, highest ${formatLength(v.maxFill)} — needs ${vol(h.fillBank)} in place`,
    `Dirt balance: ${vol(v.cut)} dug − ${vol(Math.min(v.cut, h.fillBank))} used to fill depressions = ${
      v.cut >= h.fillBank ? `${vol(v.cut - h.fillBank)} left over to remove` : `${vol(h.fillBank - v.cut)} short`
    }`,
    `Material: ${s.material.label} (swell ${s.material.swellPct}%, shrinkage ${s.material.shrinkPct}%)`,
    `Result: ${outcome}`,
    "Volumes are estimates from a LiDAR scan (prismatic cells); verify on site before quoting.",
  ].join("\n");
}
