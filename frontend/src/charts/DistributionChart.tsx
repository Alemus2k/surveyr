import type { Histogram } from "../types";
import { useElementWidth } from "./useElementWidth";

export type ChartKind = "histogram" | "area" | "cumulative";

interface Props {
  data: Histogram;
  kind: ChartKind;
  color: string;
  unit: string;
  format?: (v: number) => string;
}

const H = 140;
const PAD = { left: 8, right: 8, top: 18, bottom: 22 };

/** Distribution chart drawn at its container's real width: bars, area, or cumulative %. */
export function DistributionChart({ data, kind, color, unit, format }: Props) {
  const [ref, W] = useElementWidth<HTMLDivElement>();
  const { counts, edges } = data;
  if (counts.length === 0) return <p className="panel-note">No data</p>;

  const e0 = edges[0];
  const e1 = edges[edges.length - 1];
  const max = Math.max(...counts, 1);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const isCum = kind === "cumulative";
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xFor = (v: number) => PAD.left + ((v - e0) / (e1 - e0 || 1)) * plotW;
  const yFor = (norm: number) => PAD.top + (1 - norm) * plotH;
  const bottom = yFor(0);
  const fmt = format ?? ((v: number) => (isCum ? `${Math.round(v)}%` : `${v}`));

  const linePoints: Array<[number, number]> = [];
  if (isCum) {
    let cum = 0;
    linePoints.push([xFor(e0), bottom]);
    counts.forEach((c, i) => {
      cum += c;
      linePoints.push([xFor(edges[i + 1]), yFor(cum / total)]);
    });
  } else {
    counts.forEach((c, i) => linePoints.push([xFor((edges[i] + edges[i + 1]) / 2), yFor(c / max)]));
  }
  const line = linePoints.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${linePoints[linePoints.length - 1][0].toFixed(1)} ${bottom} L ${linePoints[0][0].toFixed(1)} ${bottom} Z`;
  const slot = plotW / counts.length;

  return (
    <div ref={ref} className="chart-box">
      <svg width={W} height={H} role="img" aria-label={`${kind} chart`}>
        <line x1={PAD.left} y1={bottom} x2={W - PAD.right} y2={bottom} className="chart-axis" />
        <text x={PAD.left} y={11} className="chart-label">
          {isCum ? "100%" : `max ${fmt(max)}`}
        </text>
        <text x={PAD.left} y={H - 6} className="chart-label">
          {fmt(e0)}
        </text>
        <text x={W - PAD.right} y={H - 6} className="chart-label" textAnchor="end">
          {fmt(e1)} {unit}
        </text>
        {kind === "histogram" ? (
          counts.map((c, i) => {
            const h = (c / max) * plotH;
            return (
              <rect
                key={i}
                x={PAD.left + i * slot + 1}
                y={bottom - h}
                width={Math.max(1, slot - 2)}
                height={h}
                rx={1.5}
                fill={color}
                opacity={0.85}
              />
            );
          })
        ) : (
          <>
            <path d={area} fill={color} opacity={0.2} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
      </svg>
    </div>
  );
}
