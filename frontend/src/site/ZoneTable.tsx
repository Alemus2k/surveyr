import { formatVolume } from "../lib/format";
import { formatDate } from "./dates";
import type { Status, ZoneProgress } from "./progress";

interface ZoneTableProps {
  progress: ZoneProgress[];
  scan: number; // which scan the quantities are shown at
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export const STATUS: Record<Status, { label: string; tone: "good" | "bad" | "muted" }> = {
  done: { label: "Complete", tone: "good" },
  "on-track": { label: "On track", tone: "good" },
  behind: { label: "Behind", tone: "bad" },
  stalled: { label: "Stalled", tone: "bad" },
  "not-started": { label: "Not started", tone: "muted" },
  unplanned: { label: "No plan", tone: "muted" },
};

const vol = (m3: number) => {
  const q = formatVolume(m3);
  return (
    <>
      {q.value} <span className="unit">{q.unit}</span>
    </>
  );
};

/** One row per zone: status, % complete, what's left, what moved, and the forecast finish. */
export function ZoneTable({ progress, scan, selected, onSelect }: ZoneTableProps) {
  if (progress.length === 0) return <p className="panel-note">No zones yet — use “Draw zone” on the map to outline a work area.</p>;
  return (
    <div className="zone-table-wrap">
      <table className="zone-table">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Status</th>
            <th className="num">Complete</th>
            <th className="num">Left to dig / fill</th>
            <th className="num">Moved this period</th>
            <th>Finish: forecast / plan</th>
          </tr>
        </thead>
        <tbody>
          {progress.map((p) => {
            const snap = p.snapshots[Math.min(scan, p.snapshots.length - 1)];
            const stockpile = p.zone.kind === "stockpile";
            const status = stockpile ? { label: "Stockpile", tone: "muted" as const } : STATUS[p.status];
            return (
              <tr
                key={p.zone.id}
                data-selected={p.zone.id === selected || undefined}
                onClick={() => onSelect(p.zone.id === selected ? null : p.zone.id)}
              >
                <td>
                  <span className="zone-name">
                    <i style={{ background: p.zone.color }} />
                    {p.zone.name}
                  </span>
                </td>
                <td>
                  <span className={`status-chip ${status.tone}`}>{status.label}</span>
                </td>
                <td className="num">
                  {stockpile ? (
                    <span className="mono">{vol(snap?.pileVolume ?? 0)}</span>
                  ) : snap?.pct === null || snap === undefined ? (
                    "—"
                  ) : (
                    <span className="pct-cell">
                      <span className="pct-bar">
                        <i style={{ width: `${snap.pct}%`, background: p.zone.color }} />
                      </span>
                      <span className="mono">{snap.pct.toFixed(0)}%</span>
                    </span>
                  )}
                </td>
                <td className="num mono">
                  {stockpile || !snap ? "—" : (
                    <>
                      {formatVolume(snap.remainingCut).value} / {vol(snap.remainingFill)}
                    </>
                  )}
                </td>
                <td className="num mono">{snap && scan > 0 ? vol(snap.cut + snap.fill) : "—"}</td>
                <td className="mono">
                  {stockpile ? "—" : (
                    <span className={p.status === "behind" ? "late" : undefined}>
                      {p.doneOn ? `done ${formatDate(p.doneOn)}` : p.forecast ? formatDate(p.forecast) : "—"}
                      <span className="plan"> / {p.zone.finish ? formatDate(p.zone.finish) : "no date"}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
