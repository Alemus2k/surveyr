import { formatLength, formatVolume } from "../lib/format";
import type { EarthworksCurve } from "./terrainStats";
import { useElementWidth } from "./useElementWidth";

const H = 160;
const PAD = { left: 8, right: 8, top: 18, bottom: 22 };

interface Props {
  curve: EarthworksCurve;
}

/** Cut and fill volume vs flat-pad elevation, with the balance point marked. */
export function EarthworksChart({ curve }: Props) {
  const [ref, W] = useElementWidth<HTMLDivElement>();
  const { levels, cut, fill, balance, moved } = curve;
  if (levels.length < 2) return <p className="panel-note">Not enough scanned ground to estimate earthworks.</p>;

  const lo = levels[0];
  const hi = levels[levels.length - 1];
  const vmax = Math.max(cut[0], fill[fill.length - 1], 1e-9);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (z: number) => PAD.left + ((z - lo) / (hi - lo || 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - v / vmax) * plotH;
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"} ${x(levels[i]).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const bx = x(balance);
  const moveQ = formatVolume(moved);
  const maxQ = formatVolume(vmax);

  return (
    <>
      <div ref={ref} className="chart-box">
        <svg width={W} height={H} role="img" aria-label="Cut and fill volume against pad elevation">
          <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} className="chart-axis" />
          <path d={path(cut)} fill="none" className="series-cut" strokeWidth={2} />
          <path d={path(fill)} fill="none" className="series-fill" strokeWidth={2} />
          <line x1={bx} y1={PAD.top - 4} x2={bx} y2={y(0)} className="chart-marker" strokeDasharray="3 3" />
          <circle cx={bx} cy={y(moved)} r={4} className="chart-marker-dot" />
          <text x={PAD.left} y={11} className="chart-label">
            max {maxQ.value} {maxQ.unit}
          </text>
          <text x={PAD.left} y={H - 6} className="chart-label">
            {formatLength(lo)}
          </text>
          <text x={W - PAD.right} y={H - 6} className="chart-label" textAnchor="end">
            {formatLength(hi)} pad
          </text>
        </svg>
      </div>
      <div className="chart-legend">
        <span>
          <i className="swatch-line series-cut" /> Cut (dig out)
        </span>
        <span>
          <i className="swatch-line series-fill" /> Fill (bring in)
        </span>
      </div>
      <p className="chart-readout">
        Balanced pad at <strong className="fig">{formatLength(balance)}</strong> moves{" "}
        <strong className="fig">
          {moveQ.value} {moveQ.unit}
        </strong>{" "}
        each way.
      </p>
    </>
  );
}
