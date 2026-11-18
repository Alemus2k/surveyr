// Small SVG charts for the Checks & records tab: an elevation profile (long
// profile or cross-section), the walk's slope strip and a settlement time chart.
import { useElementWidth } from "../../charts/useElementWidth";
import { elevationTicks, formatSmall, niceLengthStep, niceStep, useUnitSystem } from "../../lib/units";
import { formatDate } from "../dates";
import type { MonitorFlight, Stretch } from "../checksApi";

export type SeriesTone = "flight" | "previous" | "design" | "floor" | "pipe";

export interface Series {
  key: string;
  label: string;
  xs: number[];
  zs: (number | null)[];
  tone: SeriesTone;
}

const PAD = { left: 64, right: 12, top: 10, bottom: 24 };

function path(xs: number[], ys: (number | null)[], x: (v: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  xs.forEach((xv, i) => {
    const yv = ys[i];
    if (yv === null || yv === undefined || !Number.isFinite(yv)) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(xv).toFixed(1)},${y(yv).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Elevation against distance: flight, previous flight, design (and trench floor / pipe). */
export function ProfileChart({ series, xLabel, marker, height = 220, ariaLabel }: {
  series: Series[];
  xLabel: (m: number) => string;
  marker?: number | null; // a vertical line, e.g. the centreline or the current station
  height?: number;
  ariaLabel: string;
}) {
  useUnitSystem();
  const [ref, W] = useElementWidth<HTMLDivElement>(600);
  const all = series.flatMap((s) => s.zs.filter((v): v is number => v !== null && Number.isFinite(v)));
  const xsAll = series.flatMap((s) => s.xs);
  if (all.length < 2 || xsAll.length < 2) return <p className="panel-note">No ground measured along this line in the flight.</p>;
  let lo = Math.min(...all), hi = Math.max(...all);
  const padZ = Math.max((hi - lo) * 0.08, 0.05);
  lo -= padZ;
  hi += padZ;
  const x0 = Math.min(...xsAll), x1 = Math.max(...xsAll);
  const pw = W - PAD.left - PAD.right, ph = height - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * pw;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ph;
  const step = niceLengthStep((x1 - x0) / Math.max(2, Math.floor(pw / 90))).metres;
  const xt: number[] = [];
  for (let v = Math.ceil(x0 / step) * step; v <= x1 + 1e-9; v += step) xt.push(v);
  return (
    <div ref={ref} className="chart-box checks-chart">
      <svg width={W} height={height} role="img" aria-label={ariaLabel}>
        {elevationTicks(lo, hi, 4).map((t) => (
          <g key={t.metres}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t.metres)} y2={y(t.metres)} className="site-chart-grid" />
            <text x={PAD.left - 6} y={y(t.metres) + 4} className="chart-label" textAnchor="end">{t.label}</text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={v} x={x(v)} y={height - 6} className="chart-label" textAnchor="middle">{xLabel(v)}</text>
        ))}
        {marker !== undefined && marker !== null && <line x1={x(marker)} x2={x(marker)} y1={PAD.top} y2={PAD.top + ph} className="checks-marker" />}
        {series.map((s) => (
          <path key={s.key} d={path(s.xs, s.zs, x, y)} className={`checks-line ${s.tone}`}>
            <title>{s.label}</title>
          </path>
        ))}
      </svg>
      <div className="chart-legend checks-legend">
        {series.map((s) => (
          <span key={s.key}><i className={`checks-key ${s.tone}`} /> {s.label}</span>
        ))}
      </div>
    </div>
  );
}

/** The walk unrolled along its length: each stretch's slope as a bar, the 2 m local slopes as dots, the limit dashed. */
export function SlopeStrip({ stretches, local, component, limit, length, xLabel }: {
  stretches: Stretch[];
  local: ({ at_m: number; running_pct: number; cross_pct: number } | null)[];
  component: "cross" | "running";
  limit: number; // %
  length: number;
  xLabel: (m: number) => string;
}) {
  const [ref, W] = useElementWidth<HTMLDivElement>(600);
  const H = 170;
  const val = (s: { cross_pct: number; running_pct: number }) => Math.abs(component === "cross" ? s.cross_pct : s.running_pct);
  const top = Math.max(limit * 2, ...stretches.map(val), ...local.filter((l) => l).map((l) => Math.min(val(l!), limit * 3)));
  const pw = W - 46 - PAD.right, ph = H - PAD.top - PAD.bottom;
  const x = (m: number) => 46 + (m / (length || 1)) * pw;
  const y = (p: number) => PAD.top + (1 - Math.min(p, top) / top) * ph;
  const ystep = niceStep(top / 4);
  const yt: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += ystep) yt.push(v);
  const step = niceLengthStep(length / Math.max(2, Math.floor(pw / 90))).metres;
  const xt: number[] = [];
  for (let v = 0; v <= length + 1e-9; v += step) xt.push(v);
  return (
    <div ref={ref} className="chart-box checks-chart">
      <svg width={W} height={H} role="img" aria-label={`${component === "cross" ? "Cross" : "Running"} slope along the walk`}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={46} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="site-chart-grid" />
            <text x={40} y={y(v) + 4} className="chart-label" textAnchor="end">{`${Number(v.toFixed(2))} %`}</text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={v} x={x(v)} y={H - 6} className="chart-label" textAnchor="middle">{xLabel(v)}</text>
        ))}
        {stretches.map((s, i) => {
          const status = component === "cross" ? s.cross_status : s.running_status;
          return (
            <rect key={i} x={x(s.from_m)} width={Math.max(1, x(s.to_m) - x(s.from_m))} y={y(val(s))} height={PAD.top + ph - y(val(s))} className={`checks-bar ${status}`}>
              <title>{`${val(s).toFixed(1)} % ± ${(component === "cross" ? s.cross_se_pct : s.running_se_pct).toFixed(1)} %`}</title>
            </rect>
          );
        })}
        {local.map((l, i) => l && <circle key={i} cx={x(l.at_m)} cy={y(val(l))} r={2} className="checks-dot" />)}
        <line x1={46} x2={W - PAD.right} y1={y(limit)} y2={y(limit)} className="checks-limit" />
      </svg>
      <div className="chart-legend checks-legend">
        <span><i className="checks-key bar" /> stretch slope (what's judged)</span>
        <span><i className="checks-key dot" /> 2 m windows (noisy)</span>
        <span><i className="checks-key limit" /> ADA limit {limit} %</span>
      </div>
    </div>
  );
}

/** Movement since the baseline, flight by flight: worst settlement, the average with its uncertainty, the alert. */
export function MovementChart({ dates, flights, alert, picked }: { dates: string[]; flights: MonitorFlight[]; alert: number; picked: number }) {
  useUnitSystem();
  const [ref, W] = useElementWidth<HTMLDivElement>(600);
  const H = 200;
  const vals = flights.flatMap((f) => (f.measured ? [-(f.settled_max_m ?? 0), f.heave_max_m ?? 0, f.mean_m ?? 0] : []));
  if (!vals.length) return <p className="panel-note">No movement measured yet: the area hasn't settled into place, or there's only one flight after it.</p>;
  const lo = Math.min(-alert * 1.3, ...vals), hi = Math.max(alert * 0.6, ...vals);
  const pw = W - PAD.left - PAD.right, ph = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (dates.length > 1 ? i / (dates.length - 1) : 0.5) * pw;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ph;
  const step = niceStep((hi - lo) / 4);
  const yt: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) yt.push(Number(v.toFixed(6)));
  const idx = flights.map((f, i) => (f.measured ? i : -1)).filter((i) => i >= 0);
  const line = (get: (f: MonitorFlight) => number) => idx.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(get(flights[i])).toFixed(1)}`).join("");
  const band = idx.length
    ? idx.map((i, k) => `${k ? "L" : "M"}${x(i)},${y((flights[i].mean_m ?? 0) + (flights[i].mean_uncertainty_m ?? 0))}`).join("") +
      [...idx].reverse().map((i) => `L${x(i)},${y((flights[i].mean_m ?? 0) - (flights[i].mean_uncertainty_m ?? 0))}`).join("") + "Z"
    : "";
  return (
    <div ref={ref} className="chart-box checks-chart">
      <svg width={W} height={H} role="img" aria-label="Movement since the baseline at each flight">
        {yt.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 ? "chart-axis" : "site-chart-grid"} />
            <text x={PAD.left - 6} y={y(v) + 4} className="chart-label" textAnchor="end">{formatSmall(v, { signed: true })}</text>
          </g>
        ))}
        {dates.map((d, i) => (
          <text key={d} x={x(i)} y={H - 6} className={`chart-label ${i === picked ? "checks-picked" : ""}`} textAnchor="middle">{formatDate(d, true)}</text>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(-alert)} y2={y(-alert)} className="checks-limit" />
        <line x1={x(picked)} x2={x(picked)} y1={PAD.top} y2={PAD.top + ph} className="checks-marker" />
        <path d={band} className="checks-band" />
        <path d={line((f) => f.mean_m ?? 0)} className="checks-line previous" />
        <path d={line((f) => -(f.settled_max_m ?? 0))} className="checks-line settled" />
        {idx.map((i) => (
          <circle key={i} cx={x(i)} cy={y(-(flights[i].settled_max_m ?? 0))} r={3.5} className={`checks-pt ${flights[i].alert ? "bad" : ""}`}>
            <title>{`${formatDate(dates[i])}: worst ${formatSmall(-(flights[i].settled_max_m ?? 0), { signed: true })}`}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-legend checks-legend">
        <span><i className="checks-key settled" /> worst spot (averaged over a few metres)</span>
        <span><i className="checks-key previous" /> average over the area, shaded ± uncertainty</span>
        <span><i className="checks-key limit" /> alert</span>
      </div>
    </div>
  );
}
