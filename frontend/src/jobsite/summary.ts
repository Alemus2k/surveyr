import { formatArea, formatVolume } from "../lib/format";
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

const vol = (m3: number) => {
  const q = formatVolume(m3);
  return `${q.value} ${q.unit}`;
};
const area = (m2: number) => {
  const q = formatArea(m2);
  return `${q.value} ${q.unit}`;
};

/** Plain-text earthworks summary for pasting into an email or quote. */
export function jobsiteSummary(s: SummaryInput): string {
  const pad = `${s.balanced ? "Balanced pad" : "Pad"} at ${s.padElevation.toFixed(2)} m`;
  const fall = s.slopePct > 0 ? `, falling ${s.slopePct}% toward ${s.fallsToward}` : " (level)";
  const { haul: h, volumes: v } = s;
  const outcome =
    h.direction === "balanced"
      ? "Balanced on site — no import or export."
      : `${h.direction === "export" ? "Export" : "Import"} ${vol(h.loose)} loose (${vol(h.bank)} in the ground) ≈ ${h.loads.toLocaleString("en-GB")} loads of ${s.truckM3} m³.`;
  return [
    `Surveyr — job site earthworks: ${s.project}`,
    `${pad}${fall}`,
    `Scanned area: ${area(s.scannedArea)} (grid ${s.cellSize} m)`,
    `Cut: ${vol(v.cut)} in place over ${area(v.cutArea)}, deepest ${v.maxCut.toFixed(2)} m`,
    `Fill: ${vol(v.fill)} compacted over ${area(v.fillArea)}, highest ${v.maxFill.toFixed(2)} m — needs ${vol(h.fillBank)} in place`,
    `Material: ${s.material.label} (swell ${s.material.swellPct}%, shrinkage ${s.material.shrinkPct}%)`,
    `Result: ${outcome}`,
    "Volumes are estimates from a LiDAR scan (prismatic cells); verify on site before quoting.",
  ].join("\n");
}
