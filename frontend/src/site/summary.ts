import { formatVolume } from "../lib/format";
import { formatDate } from "./dates";
import { overallPct, type PayAppCheck, type ZoneProgress } from "./progress";

const STATUS_TEXT: Record<string, string> = {
  done: "complete",
  "on-track": "on track",
  behind: "BEHIND",
  stalled: "STALLED",
  "not-started": "not started",
  unplanned: "no planned finish",
};

const m3 = (v: number) => `${formatVolume(v).value} m³`;

/** Plain-text progress report for the latest scan, to paste into an email or log. */
export function siteSummary(name: string, progress: ZoneProgress[], checks: PayAppCheck[], overbillPct: number): string {
  const any = progress.find((p) => p.snapshots.length);
  if (!any) return `${name}: no scans yet.`;
  const k = any.snapshots.length - 1;
  const latest = any.snapshots[k].date;
  const previous = k > 0 ? any.snapshots[k - 1].date : null;
  const overall = overallPct(progress);
  const lines = [
    `${name} — site progress at ${formatDate(latest)}${previous ? ` (since ${formatDate(previous)})` : ""}`,
    overall === null ? "" : `Overall earthworks complete: ${overall.toFixed(0)}%`,
    "",
  ];
  for (const p of progress) {
    const s = p.snapshots[k];
    if (p.zone.kind === "stockpile") {
      lines.push(`• ${p.zone.name}: stockpile ${m3(s.pileVolume)}`);
      continue;
    }
    const pct = s.pct === null ? "—" : `${s.pct.toFixed(0)}%`;
    const finish = p.doneOn
      ? `done ${formatDate(p.doneOn)}`
      : `forecast ${p.forecast ? formatDate(p.forecast) : "—"}${p.zone.finish ? `, planned ${formatDate(p.zone.finish)}` : ""}`;
    lines.push(`• ${p.zone.name}: ${pct} complete, ${STATUS_TEXT[p.status]} (${finish})`);
    if (!p.doneOn) lines.push(`    left: dig ${m3(s.remainingCut)}, fill ${m3(s.remainingFill)}; moved this period ${m3(s.cut + s.fill)}`);
  }
  const flagged = checks.filter((c) => c.flagged);
  if (checks.length) {
    lines.push("", flagged.length ? `Pay apps to query (> ${overbillPct}% above measured):` : "Pay apps: all claims match the scans.");
    for (const c of flagged) {
      lines.push(
        `• ${formatDate(c.payApp.date)} ${c.payApp.contractor || "claim"}: claimed ${m3(c.payApp.claimed_m3)}, measured ${m3(c.measured ?? 0)}`
      );
    }
  }
  lines.push("", "Measured from repeat scans in Surveyr. Volumes are estimates — verify before payment decisions.");
  return lines.filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n");
}
