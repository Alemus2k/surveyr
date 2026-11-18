// Measurement results as words and numbers for people: panel rows, the short
// label drawn in the 3D view and the plain text the Copy button puts on the
// clipboard. Every quantity goes through lib/units, so a unit switch re-reads.
import {
  formatArea,
  formatCoordinate,
  formatDistance,
  formatElevation,
  formatLength,
  formatSigned,
  formatSmall,
  getUnitSystem,
  quantityText,
} from "../lib/units";
import {
  formatBearing,
  formatGradePct,
  formatGradeRatio,
  measureDistance,
  measurePath,
  polygonPerimeter,
  type DistanceResult,
  type Vec3,
} from "./geometry";
import type { Measurement, MeasureMode } from "./state";

export const KIND_LABEL: Record<MeasureMode, string> = { point: "Point", distance: "Distance", path: "Path", area: "Area" };
const KIND_TAG: Record<MeasureMode, string> = { point: "P", distance: "D", path: "L", area: "A" };

/** "Distance 2" */
export const measurementTitle = (m: Measurement): string => `${KIND_LABEL[m.kind]} ${m.n}`;
/** "D2": the tag on the label in the 3D view. */
export const measurementTag = (m: Measurement): string => `${KIND_TAG[m.kind]}${m.n}`;

/** Drone LiDAR is good to about ±2–5 cm vertically; the difference of two spots is about this good. */
export const DIFF_SIGMA_M = 0.04;

/** Below this plan distance a grade is mostly scan noise: 10 ft (3 m in metric). */
export function shortRunMetres(): number {
  return getUnitSystem() === "us" ? 3.048 : 3;
}

/** How far off a grade over ``run`` metres can be from scan noise alone, in percentage points. */
export const gradeUncertaintyPct = (run: number): number => (DIFF_SIGMA_M / run) * 100;

export interface Row {
  label: string;
  value: string;
  hint?: string; // tooltip: what the number measures, the technical term
}

/** "2.0 % falling (50:1)" — the direction is from the first spot to the second. */
export function gradeText(r: DistanceResult): string {
  if (r.gradePct === null) return "straight up";
  const ratio = formatGradeRatio(r.gradePct);
  if (!ratio) return "level";
  return `${formatGradePct(r.gradePct)} ${r.gradePct > 0 ? "rising" : "falling"} (${ratio})`;
}

export const spotText = (p: Vec3): string =>
  `E ${formatCoordinate(p[0])}, N ${formatCoordinate(p[1])}, elev. ${formatElevation(p[2])}`;

/** A plain-words warning when a grade is too short to trust, else null. */
export function shortRunWarning(run: number): string | null {
  if (run >= shortRunMetres()) return null;
  return (
    `Short distance: under ${formatDistance(shortRunMetres())} the grade can be off by ` +
    `±${formatGradePct(gradeUncertaintyPct(Math.max(run, 0.01)))} from scan noise alone ` +
    `(drone LiDAR is ±2–5 cm). Measure over a longer run for a grade you can rely on.`
  );
}

function distanceRows(a: Vec3, b: Vec3): Row[] {
  const r = measureDistance(a, b);
  const rows: Row[] = [
    { label: "Horizontal distance", value: formatLength(r.horizontal), hint: "Distance on the plan, as a tape on level ground would read" },
    { label: "Height change", value: formatSigned(r.vertical), hint: "Second spot minus first spot (rise +, fall −)" },
    { label: "Slope distance", value: formatLength(r.slope), hint: "Straight line between the two spots, up or down the slope" },
    { label: "Grade", value: gradeText(r), hint: "Rise over run: % and horizontal:vertical ratio" },
  ];
  if (r.azimuth !== null) {
    rows.push({ label: "Direction", value: formatBearing(r.azimuth), hint: "Quadrant bearing from the first spot to the second, from grid north" });
  }
  rows.push(
    { label: "First spot", value: formatElevation(a[2]), hint: spotText(a) },
    { label: "Second spot", value: formatElevation(b[2]), hint: spotText(b) }
  );
  return rows;
}

/** The result rows for a finished measurement (or a draft treated as one). */
export function resultRows(m: Pick<Measurement, "kind" | "points" | "surface">): Row[] {
  const pts = m.points;
  if (m.kind === "point") {
    const [p] = pts;
    return [
      { label: "Elevation", value: formatElevation(p[2]), hint: "Ground height: middle of the 9 nearest scan points" },
      { label: "Easting", value: formatCoordinate(p[0]), hint: "Grid easting of the scan's coordinate system" },
      { label: "Northing", value: formatCoordinate(p[1]), hint: "Grid northing of the scan's coordinate system" },
    ];
  }
  if (m.kind === "distance") return distanceRows(pts[0], pts[1]);
  if (m.kind === "path") {
    const r = measurePath(pts);
    return [
      { label: "Length (horizontal)", value: formatLength(r.horizontal), hint: "Sum of the legs measured on the plan" },
      { label: "Length along the ground", value: formatLength(r.slope), hint: "Sum of the legs following their slopes (slope length)" },
      { label: "Height change", value: formatSigned(r.vertical), hint: "Last spot minus first spot" },
      { label: "Total climb / drop", value: `${formatLength(r.climb)} / ${formatLength(r.descent)}`, hint: "All the rises and all the falls along the way" },
    ];
  }
  const rows: Row[] = [];
  const s = m.surface;
  rows.push({ label: "Area (plan)", value: quantityText(formatArea(s?.planArea ?? 0)), hint: "Area on the plan, as drawn on a site plan" });
  rows.push({ label: "Perimeter", value: formatLength(polygonPerimeter(pts)), hint: "Distance around the outline, on the plan" });
  if (!s) {
    rows.push({ label: "Surface area", value: "working…" });
  } else if (s.surfaceArea === null) {
    rows.push({ label: "Surface area", value: "not scanned", hint: "No scan points inside the outline" });
  } else {
    rows.push({
      label: "Surface area",
      value: quantityText(formatArea(s.surfaceArea)),
      hint: "Area following the ground's slopes and bumps (what seed, fabric or topsoil covers)",
    });
    rows.push({ label: "Average elevation", value: formatElevation(s.meanElevation!), hint: "Mean ground height inside the outline" });
    rows.push({
      label: "Lowest / highest",
      value: `${formatElevation(s.minElevation!)} / ${formatElevation(s.maxElevation!)}`,
      hint: `Ground sampled every ${formatDistance(s.cell)}`,
    });
  }
  return rows;
}

/** Notes that change how far a result can be trusted. */
export function resultNotes(m: Pick<Measurement, "kind" | "points" | "surface">): string[] {
  const notes: string[] = [];
  if (m.kind === "distance") {
    const w = shortRunWarning(measureDistance(m.points[0], m.points[1]).horizontal);
    if (w) notes.push(w);
  }
  if (m.kind === "area" && m.surface && m.surface.surfaceArea !== null && m.surface.coverage < 0.98) {
    notes.push(
      `${Math.round((1 - m.surface.coverage) * 100)} % of the outline has no scan points; the surface area ` +
        `assumes the gaps are as rough as the rest, and the elevations only describe the scanned part.`
    );
  }
  return notes;
}

/** Per-leg rows for a path: horizontal length and grade. */
export function pathLegs(points: Vec3[]): { horizontal: string; grade: string; warn: boolean }[] {
  return measurePath(points).legs.map((l) => ({
    horizontal: formatLength(l.horizontal),
    grade: gradeText(l),
    warn: l.horizontal < shortRunMetres(),
  }));
}

/** The short text drawn next to a measurement in the 3D view. */
export function sceneLabel(m: Pick<Measurement, "kind" | "points" | "surface">): string {
  const pts = m.points;
  if (m.kind === "point") return formatElevation(pts[0][2]);
  if (m.kind === "distance") {
    const r = measureDistance(pts[0], pts[1]);
    return r.gradePct === null ? formatLength(r.horizontal) : `${formatLength(r.horizontal)} · ${formatGradePct(r.gradePct)}`;
  }
  if (m.kind === "path") return `${formatLength(measurePath(pts).horizontal)} total`;
  return m.surface ? quantityText(formatArea(m.surface.planArea)) : "…";
}

/** Plain text for the clipboard. */
export function measurementText(m: Measurement): string {
  const lines = [measurementTitle(m)];
  const spots = m.kind === "point" ? [] : m.points.map((p, i) => `  ${m.kind === "distance" ? (i ? "Second" : "First") : `Spot ${i + 1}`}: ${spotText(p)}`);
  for (const r of resultRows(m)) {
    if (m.kind === "distance" && (r.label === "First spot" || r.label === "Second spot")) continue;
    lines.push(`  ${r.label}: ${r.value}`);
  }
  if (m.kind === "path") {
    pathLegs(m.points).forEach((l, i) => lines.push(`  Leg ${i + 1}: ${l.horizontal}, ${l.grade}`));
  }
  lines.push(...spots);
  for (const n of resultNotes(m)) lines.push(`  Note: ${n}`);
  return lines.join("\n");
}

/** Every measurement, for "Copy all". */
export function allMeasurementsText(items: Measurement[]): string {
  return [
    ...items.map(measurementText),
    `Elevations from the drone scan: ±${formatSmall(0.05)} or better (drone LiDAR is ±2–5 cm vertical).`,
  ].join("\n\n");
}
