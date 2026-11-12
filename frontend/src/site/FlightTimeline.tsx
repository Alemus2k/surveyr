import { formatOffset, GRADE_LABEL, type Verdict } from "../control/qa";
import { formatDate } from "./dates";
import type { SiteScan } from "./types";

export type FlightVerdict = Verdict & { rmse: number | null };

interface FlightTimelineProps {
  scans: SiteScan[];
  scan: number; // selected flight
  verdicts: ReadonlyMap<string, FlightVerdict>; // accuracy against the site's check points, if any
  onScan: (projectId: string | null) => void; // null = latest
}

/** The site's flights in date order; pick one to see the site as it was then. */
export function FlightTimeline({ scans, scan, verdicts, onScan }: FlightTimelineProps) {
  const last = scans.length - 1;
  return (
    <nav className="site-timeline" aria-label="Flights">
      {scans.map((s, k) => {
        const v = verdicts.get(s.project_id);
        return (
          <button key={s.project_id} aria-pressed={k === scan} onClick={() => onScan(k === last ? null : s.project_id)}>
            <span className="fig">{formatDate(s.date, true)}</span>
            <span className="tl-sub">{k === 0 ? "first scan" : k === last ? "latest" : `scan ${k + 1}`}</span>
            {v && v.grade !== "none" && (
              <span
                className={`qa-badge ${v.bias !== null ? "fair" : v.grade}`}
                title={`Check points: ${GRADE_LABEL[v.grade]}, RMSE ${formatOffset(v.rmse ?? 0, false)}${v.bias !== null ? `, offset ${formatOffset(v.bias)}` : ""}`}
              >
                {v.bias !== null ? formatOffset(v.bias) : `±${formatOffset(v.rmse ?? 0, false)}`}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
