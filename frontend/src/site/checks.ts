// Checks & records: wording and formatting for the tab (pure, tested in checks.test.ts).
// The engine sends metric numbers and codes; everything a person reads is built here.
import { formatArea as areaParts, formatCoordinate, formatElevation, formatLength, formatSmall, getUnitSystem, M_PER_FT, quantityText, type UnitSystem } from "../lib/units";
import type { FlatworkResult, MonitorFlight, Stretch, TrenchFlag, TrenchResult } from "./checksApi";
import type { AsBuilt, Flatwork } from "./types";

// ------------------------------------------------------------------ stations

/**
 * A distance along a line the way road plans write it: "1+20" = 120 ft in US
 * (hundreds of feet + feet), "0+120" = 120 m in metric (kilometres + metres).
 */
export function formatStation(m: number, digits = 0, system: UnitSystem = getUnitSystem()): string {
  const us = system === "us";
  const v = us ? m / M_PER_FT : m;
  const per = us ? 100 : 1000;
  const scale = 10 ** digits;
  const total = Math.round(Math.abs(v) * scale) / scale;
  const major = Math.floor(total / per + 1e-9);
  const rest = total - major * per;
  const width = (us ? 2 : 3) + (digits ? digits + 1 : 0);
  return `${v < 0 && total > 0 ? "−" : ""}${major}+${rest.toFixed(digits).padStart(width, "0")}`;
}

/** Signed percent with one or two decimals: "3.4 %". Slopes are ratios, the same in every unit system. */
export const pct = (v: number, digits = 1) => `${Math.abs(v).toFixed(digits)} %`;

// ------------------------------------------------------------------ pipe sizes

const US_SIZES_IN = [4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30, 36, 42, 48, 54, 60, 72];
const METRIC_SIZES_MM = [100, 150, 200, 250, 300, 375, 450, 525, 600, 675, 750, 900, 1050, 1200, 1350, 1500, 1800];
export const DEFAULT_PIPE_M = 0.3; // 12 in / 300 mm: the smallest common storm drain

/** Nominal pipe sizes offered in the user's units, as [metres, label]. */
export function pipeSizes(system: UnitSystem = getUnitSystem()): [number, string][] {
  return system === "us" ? US_SIZES_IN.map((i) => [i * 0.0254, `${i} in`]) : METRIC_SIZES_MM.map((mm) => [mm / 1000, `${mm} mm`]);
}

/** A pipe's nominal size as plans write it: "18 in" / "450 mm". */
export function pipeLabel(m: number, system: UnitSystem = getUnitSystem()): string {
  return system === "us" ? `${Math.round(m / 0.0254)} in` : `${Math.round(m * 1000)} mm`;
}

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(mm|cm|m|in(?:ch(?:es)?)?|"|ft)(?![a-z])/i;

/** The pipe size written in an as-built's note ("450 mm storm drain", 18" RCP), in metres; null if none. */
export function parsePipeSize(note: string): number | null {
  const m = note.match(SIZE_RE);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = m[2].toLowerCase();
  const metres = unit === "mm" ? v / 1000 : unit === "cm" ? v / 100 : unit === "m" ? v : unit === "ft" ? v * M_PER_FT : v * 0.0254;
  return metres > 0.02 && metres < 5 ? metres : null;
}

/** The note with its pipe size replaced (or added in front), kept under the engine's 200 characters. */
export function withPipeSize(note: string, m: number, system: UnitSystem = getUnitSystem()): string {
  const label = pipeLabel(m, system);
  const out = SIZE_RE.test(note) ? note.replace(SIZE_RE, label) : `${label} pipe${note ? `. ${note}` : ""}`;
  return out.slice(0, 200);
}

// ------------------------------------------------------------------ wording

export interface Finding {
  level: "bad" | "warn" | "info";
  title: string;
  detail: string;
}

/** An OSHA trench prompt in plain words. These are prompts to check on site, not rulings. */
export function trenchFinding(f: TrenchFlag): Finding {
  const depth = f.depth_m !== undefined ? formatLength(f.depth_m) : "";
  switch (f.code) {
    case "protective_system":
      return {
        level: "bad",
        title: `${depth} deep with near-vertical walls`,
        detail:
          "Deeper than 5 ft: OSHA needs a protective system — sloping, shoring or a trench box — unless it's in stable rock. Check one is in place where people work (the scan can't see a box that was pulled for the flight).",
      };
    case "protective_system_sloped":
      return {
        level: "warn",
        title: `${depth} deep, walls look sloped`,
        detail: "Deeper than 5 ft. The walls look laid back; confirm the slope suits the soil type (OSHA Appendix B).",
      };
    case "spoil_setback":
      return {
        level: "bad",
        title: `Spoil pile ${formatLength(f.setback_m ?? 0)} from the edge`,
        detail: `OSHA wants spoil and equipment at least 2 ft (${formatLength(0.6096)}) back from the edge, so it can't fall or roll in. Pull the pile back.`,
      };
    case "ladder":
      return {
        level: "info",
        title: "Ladder within 25 ft",
        detail: "Deeper than 4 ft: there must be a ladder, stairway or ramp within 25 ft of every worker in the trench.",
      };
    case "pe_design":
      return {
        level: "bad",
        title: `${depth} deep — over 20 ft`,
        detail: "Over 20 ft deep, the protective system must be designed by a registered professional engineer.",
      };
    case "pipe_not_seen":
      return {
        level: "info",
        title: "Pipe not seen",
        detail: "No pipe showed in the flight's points (it may be unclassified as ground, or not laid yet): the record gives the trench floor, not inverts.",
      };
  }
}

const KIND_NAMES: Record<Flatwork["kind"], string> = { walk: "walk", ramp: "ramp", landing: "landing", parking: "accessible parking" };

/** One stretch of flatwork that is (or may be) over an ADA limit, as a table line. */
export function stretchFinding(s: Stretch, r: Pick<FlatworkResult, "running_limit_pct" | "cross_limit_pct" | "kind">): Finding[] {
  const out: Finding[] = [];
  for (const comp of ["cross", "running"] as const) {
    const status = comp === "cross" ? s.cross_status : s.running_status;
    if (status === "ok") continue;
    const slope = comp === "cross" ? s.cross_pct : s.running_pct;
    const se = comp === "cross" ? s.cross_se_pct : s.running_se_pct;
    const limit = comp === "cross" ? r.cross_limit_pct : r.running_limit_pct;
    const name = comp === "cross" ? "Cross slope" : "Running slope";
    out.push({
      level: status === "fail" ? "bad" : "warn",
      title: `${name} ${pct(slope)} over ${formatLength(s.length_m)} at E ${formatCoordinate(s.middle[0])}, allowed ${pct(limit, limit % 1 ? 2 : 0)}`,
      detail:
        status === "fail"
          ? `Too steep for a wheelchair (${KIND_NAMES[r.kind]}, ±${pct(se)} measuring spread). Confirm with a smart level before tearing out.`
          : `Possibly over the limit, but within the scan's measuring spread (±${pct(se)}). Check it with a smart level.`,
    });
  }
  return out;
}

/** A settlement monitor's state at one flight, in a line. */
export function monitorFinding(name: string, f: MonitorFlight | undefined, alert: number): Finding | null {
  if (!f || !f.measured) return null;
  const settled = f.settled_max_m ?? 0;
  const heave = f.heave_max_m ?? 0;
  const worst = settled >= heave ? `settled up to ${formatSmall(settled)}` : `rose up to ${formatSmall(heave)}`;
  const unc = f.cell_uncertainty_m ? ` (±${formatSmall(f.cell_uncertainty_m)})` : "";
  return f.alert
    ? { level: "bad", title: `${name} has ${worst}${unc}`, detail: `More than the ${formatSmall(alert)} alert over ${formatArea(f.over_alert_m2 ?? 0)}.` }
    : { level: "info", title: `${name}: ${worst}${unc}`, detail: `Under the ${formatSmall(alert)} alert.` };
}

const formatArea = (m2: number) => quantityText(areaParts(m2));

/** The tab's one-line answer. */
export function verdictHeadline(problems: number, toCheck: number): string {
  if (problems === 0 && toCheck === 0) return "Nothing to look at before the inspector does";
  const parts: string[] = [];
  if (problems) parts.push(`${problems} thing${problems === 1 ? "" : "s"} to look at before the inspector does`);
  if (toCheck) parts.push(`${toCheck} to check with a level`);
  return parts.join(" · ");
}

// ------------------------------------------------------------------ the trench record

function bearing(dir: [number, number] | undefined): string {
  if (!dir) return "";
  const deg = (Math.atan2(dir[0], dir[1]) * 180) / Math.PI;
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return names[Math.round(((deg + 360) % 360) / 45) % 8];
}

/** Which way the pipe falls, in words: "falls 0.80 % to the west". */
export function pipeFallText(r: TrenchResult): string {
  const slope = r.pipe?.slope_pct;
  if (slope === undefined || !r.direction) return "";
  const dir = slope > 0 ? ([-r.direction[0], -r.direction[1]] as [number, number]) : r.direction;
  return `falls ${pct(slope, 2)} to the ${bearing(dir)}`;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The permanent as-built record as CSV, units in the headers (opens in Excel). */
export function recordCsv(rec: AsBuilt, r: TrenchResult, system: UnitSystem = getUnitSystem()): string {
  const us = system === "us";
  const u = us ? "ft" : "m";
  const L = (m: number | null) => (m === null ? "" : (us ? m / M_PER_FT : m).toFixed(us ? 2 : 3));
  const lines = [
    ["As-built record", rec.name],
    ["Flight", r.date],
    ["Note", rec.note],
    ["Pipe size", pipeLabel(r.diameter_m, system)],
    ["Pipe slope (%)", r.pipe?.slope_pct !== undefined ? Math.abs(r.pipe.slope_pct).toFixed(2) : "not seen"],
    ["Pipe falls toward", r.pipe?.slope_pct !== undefined ? pipeFallText(r).replace(/^falls [^ ]+ % to the /, "") : ""],
    [],
    [`Centreline easting (${u})`, `Centreline northing (${u})`],
    ...rec.line.map(([e, n]) => [L(e), L(n)]),
    [],
    [`Station (${u})`, "Station", `Easting (${u})`, `Northing (${u})`, `Ground (${u})`, `Trench floor (${u})`, `Depth (${u})`, `Width (${u})`, `Pipe top (${u})`, `Invert (${u})`],
    ...(r.table ?? []).map((row) => [
      L(row.station), formatStation(row.station, 0, system), L(row.e), L(row.n), L(row.ground), L(row.floor), L(row.depth), L(row.width), L(row.pipe_top), L(row.invert),
    ]),
  ];
  return lines.map((cells) => cells.map((c) => csvCell(String(c))).join(",")).join("\n") + "\n";
}

/** The record as plain text for a daily report or an email. */
export function recordText(rec: AsBuilt, r: TrenchResult): string {
  const out = [`AS-BUILT: ${rec.name}`, `Flight ${r.date}${rec.note ? ` — ${rec.note}` : ""}`];
  if (!r.open) return [...out, "The trench isn't open in this flight."].join("\n");
  out.push(
    `Length ${formatLength(r.trench_length_m ?? 0)}, width ${formatLength(r.width_m ?? 0)}, depth ${formatLength(r.depth_mean_m ?? 0)} average / ${formatLength(r.depth_max_m ?? 0)} deepest.`
  );
  if (r.pipe?.seen)
    out.push(
      `Pipe ${pipeLabel(r.diameter_m)}: ${pipeFallText(r)}; invert ${formatElevation(r.pipe.invert_start_m ?? 0)} at the start, ${formatElevation(r.pipe.invert_end_m ?? 0)} at the end.`
    );
  else out.push("Pipe not seen in the flight; table gives the trench floor.");
  out.push("", "Station   Ground      Floor       Depth      Invert");
  for (const row of r.table ?? [])
    out.push(
      [formatStation(row.station).padEnd(9), formatElevation(row.ground).padEnd(11), formatElevation(row.floor).padEnd(11), formatLength(row.depth).padEnd(10), row.invert === null ? "—" : formatElevation(row.invert)].join(" ")
    );
  out.push("", `Centreline: ${rec.line.map(([e, n]) => `E ${formatCoordinate(e)} N ${formatCoordinate(n)}`).join(" → ")}`);
  out.push("Measured from drone LiDAR (±2–5 cm). OSHA notes are prompts to check on site, not rulings.");
  return out.join("\n");
}
