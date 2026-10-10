import { useElementWidth } from "../charts/useElementWidth";
import { dayNumber, fromDayNumber, type ZoneProgress } from "./progress";

interface ProgressChartProps {
  progress: ZoneProgress[]; // grading zones
  selected: string | null;
  today: string;
  onSelect: (id: string | null) => void;
}

const H = 230;
const PAD = { left: 40, right: 14, top: 12, bottom: 26 };
const MAX_FORECAST_DAYS = 90; // don't let a crawling trend squash the whole chart
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** % complete over time for each zone: measured (solid), planned (dashed), forecast (dotted). */
export function ProgressChart({ progress, selected, today, onSelect }: ProgressChartProps) {
  const [ref, W] = useElementWidth<HTMLDivElement>(600);
  const zones = progress.filter((p) => p.snapshots.some((s) => s.pct !== null));
  if (zones.length === 0) return <p className="panel-note">Add a design surface and grading zones to chart progress.</p>;

  const last = Math.max(...zones.map((p) => dayNumber(p.snapshots[p.snapshots.length - 1].date)));
  const days: number[] = [dayNumber(today)];
  for (const p of zones) {
    days.push(dayNumber(p.snapshots[0].date), dayNumber(p.snapshots[p.snapshots.length - 1].date));
    if (p.zone.start) days.push(dayNumber(p.zone.start));
    if (p.zone.finish) days.push(dayNumber(p.zone.finish));
    if (p.forecast) days.push(Math.min(dayNumber(p.forecast), last + MAX_FORECAST_DAYS));
  }
  const d0 = Math.min(...days) - 3;
  const d1 = Math.max(...days) + 3;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + ((day - d0) / (d1 - d0)) * plotW;
  const y = (pct: number) => PAD.top + (1 - pct / 100) * plotH;

  // month boundaries for the time axis
  const ticks: { day: number; label: string }[] = [];
  const first = fromDayNumber(d0);
  for (let yr = +first.slice(0, 4), m = +first.slice(5, 7); ; m++) {
    if (m > 12) {
      m = 1;
      yr++;
    }
    const day = dayNumber(`${yr}-${String(m).padStart(2, "0")}-01`);
    if (day > d1) break;
    if (day >= d0) ticks.push({ day, label: MONTHS[m - 1] });
  }

  const faded = (id: string) => selected !== null && selected !== id;
  const tx = x(dayNumber(today));

  return (
    <div ref={ref} className="chart-box site-chart">
      <svg width={W} height={H} role="img" aria-label="Percent complete over time for each zone">
        {[0, 25, 50, 75, 100].map((p) => (
          <g key={p}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} className={p === 0 ? "chart-axis" : "site-chart-grid"} />
            <text x={PAD.left - 6} y={y(p) + 4} className="chart-label" textAnchor="end">
              {p}%
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t.day}>
            <line x1={x(t.day)} x2={x(t.day)} y1={PAD.top} y2={y(0)} className="site-chart-grid" />
            <text x={x(t.day) + 4} y={H - 8} className="chart-label">
              {t.label}
            </text>
          </g>
        ))}
        <line x1={tx} x2={tx} y1={PAD.top} y2={y(0)} className="site-chart-today" />
        <text x={tx} y={PAD.top - 2} className="chart-label site-chart-today-label" textAnchor="middle">
          today
        </text>

        {zones.map((p) => {
          const pts = p.snapshots.filter((s) => s.pct !== null);
          const lastPt = pts[pts.length - 1];
          // a forecast beyond the chart's horizon stops at the edge, partway up its trend line
          const forecastDay = p.forecast && !p.doneOn ? Math.min(dayNumber(p.forecast), last + MAX_FORECAST_DAYS) : null;
          const forecastPct =
            forecastDay === null ? 0 : Math.min(100, lastPt.pct! + (p.rate ?? 0) * (forecastDay - dayNumber(lastPt.date)));
          return (
            <g
              key={p.zone.id}
              className="site-chart-zone"
              style={{ color: p.zone.color, opacity: faded(p.zone.id) ? 0.25 : 1 }}
              onClick={() => onSelect(selected === p.zone.id ? null : p.zone.id)}
            >
              <title>{p.zone.name}</title>
              {p.zone.start && p.zone.finish && (
                <line
                  x1={x(dayNumber(p.zone.start))}
                  y1={y(0)}
                  x2={x(dayNumber(p.zone.finish))}
                  y2={y(100)}
                  className="site-chart-plan"
                />
              )}
              {forecastDay !== null && (
                <line
                  x1={x(dayNumber(lastPt.date))}
                  y1={y(lastPt.pct!)}
                  x2={x(forecastDay)}
                  y2={y(forecastPct)}
                  className="site-chart-forecast"
                />
              )}
              <polyline
                points={pts.map((s) => `${x(dayNumber(s.date)).toFixed(1)},${y(s.pct!).toFixed(1)}`).join(" ")}
                className="site-chart-actual"
              />
              {pts.map((s) => (
                <circle key={s.date} cx={x(dayNumber(s.date))} cy={y(s.pct!)} r={3.5} className="site-chart-dot" />
              ))}
              {p.zone.finish && <circle cx={x(dayNumber(p.zone.finish))} cy={y(100)} r={4} className="site-chart-target" />}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend site-chart-legend">
        <span>
          <i className="site-key solid" /> measured
        </span>
        <span>
          <i className="site-key dashed" /> planned
        </span>
        <span>
          <i className="site-key dotted" /> forecast at current rate
        </span>
        <span>
          <i className="site-key ring" /> planned finish
        </span>
      </div>
    </div>
  );
}
