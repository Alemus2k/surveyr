import type { AspectRose } from "./terrainStats";
import { useElementWidth } from "./useElementWidth";

const MAX_SIZE = 240;
const LABEL_GAP = 14;
const COMPASS = ["N", "E", "S", "W"];

interface Props {
  rose: AspectRose;
  color: string;
  minSlope: number;
}

function wedge(cx: number, cy: number, r: number, a0: number, a1: number): string {
  // angles in degrees clockwise from north
  const p = (a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
}

/** Compass rose of which way sloped ground faces (wedge area ∝ share of cells). */
export function AspectRoseChart({ rose, color, minSlope }: Props) {
  const [ref, W] = useElementWidth<HTMLDivElement>();
  const size = Math.min(W, MAX_SIZE);
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - LABEL_GAP - 4;
  const n = rose.fractions.length;
  const step = 360 / n;
  const peak = Math.max(...rose.fractions, 1e-9);
  const dominant = rose.fractions.indexOf(peak);
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  return (
    <>
      <div ref={ref} className="chart-box chart-centre">
        <svg width={size} height={size} role="img" aria-label="Aspect rose: direction slopes face">
          {[0.33, 0.66, 1].map((k) => (
            <circle key={k} cx={cx} cy={cy} r={R * k} className="chart-ring" />
          ))}
          {rose.fractions.map((f, i) =>
            f > 0 ? (
              <path
                key={i}
                d={wedge(cx, cy, R * Math.sqrt(f / peak), i * step - step / 2 + 1, i * step + step / 2 - 1)}
                fill={color}
                opacity={0.4 + 0.5 * (f / peak)}
              />
            ) : null
          )}
          {COMPASS.map((c, i) => {
            const a = (i * 90 * Math.PI) / 180;
            return (
              <text
                key={c}
                x={cx + (R + LABEL_GAP / 2 + 2) * Math.sin(a)}
                y={cy - (R + LABEL_GAP / 2 + 2) * Math.cos(a)}
                className="chart-label"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {c}
              </text>
            );
          })}
        </svg>
      </div>
      <p className="chart-readout">
        {peak > 1e-6 && n === 16 ? (
          <>
            Mostly faces <strong>{names[dominant]}</strong> ({(peak * 100).toFixed(0)}% of sloped ground).{" "}
          </>
        ) : null}
        {rose.flatPct.toFixed(0)}% is flatter than {minSlope}° and has no clear direction.
      </p>
    </>
  );
}
