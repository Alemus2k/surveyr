import { useMemo } from "react";
import { jetCssGradient } from "../color";
import { elevationHistogram, type ColorRange, type PreparedCloud } from "../viewer/prepare";

const BINS = 60;
const HIST_W = 240;
const HIST_H = 64;

/** Colour modes a LiDAR viewer offers; only elevation is backed by data today. */
const OTHER_MODES = ["RGB colour", "Intensity", "Classification", "Return number", "Scan angle"];

interface ColorPanelProps {
  cloud: PreparedCloud;
  range: ColorRange;
  onRange: (r: ColorRange) => void;
}

export function ColorPanel({ cloud, range, onRange }: ColorPanelProps) {
  const { zMin, zMax } = cloud;
  const span = zMax - zMin || 1;
  const step = Math.max(0.01, Number((span / 500).toPrecision(1)));
  const counts = useMemo(() => elevationHistogram(cloud.z, BINS, zMin, zMax), [cloud, zMin, zMax]);
  const peak = Math.max(...counts, 1);

  const setMin = (v: number) => onRange({ min: Math.min(v, range.max - step), max: range.max });
  const setMax = (v: number) => onRange({ min: range.min, max: Math.max(v, range.min + step) });
  const binW = HIST_W / BINS;

  return (
    <div className="color-modes">
      <section className="color-card" aria-label="Elevation colouring">
        <div className="color-card-head">
          <span>Elevation</span>
          <span className="color-card-tag">Active</span>
        </div>

        <div className="range-inputs">
          <label>
            <span className="sr-only">Lowest colour elevation (m)</span>
            <input
              className="mono"
              type="number"
              step={step}
              value={range.min.toFixed(2)}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setMin(e.target.valueAsNumber)}
            />
          </label>
          <label>
            <span className="sr-only">Highest colour elevation (m)</span>
            <input
              className="mono"
              type="number"
              step={step}
              value={range.max.toFixed(2)}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setMax(e.target.valueAsNumber)}
            />
          </label>
        </div>

        <div className="histogram">
          <svg viewBox={`0 0 ${HIST_W} ${HIST_H}`} preserveAspectRatio="none" aria-hidden="true">
            {counts.map((c, i) => {
              const binMid = zMin + ((i + 0.5) / BINS) * span;
              const inside = binMid >= range.min && binMid <= range.max;
              const h = Math.max(1, Math.sqrt(c / peak) * (HIST_H - 2)); // sqrt keeps small bins visible
              return (
                <rect
                  key={i}
                  x={i * binW}
                  y={HIST_H - h}
                  width={binW - 0.6}
                  height={h}
                  className={inside ? "bar in" : "bar"}
                />
              );
            })}
          </svg>
          <input
            className="range-handle"
            type="range"
            aria-label="Lowest colour elevation"
            min={zMin}
            max={zMax}
            step={step}
            value={range.min}
            onChange={(e) => setMin(e.target.valueAsNumber)}
          />
          <input
            className="range-handle"
            type="range"
            aria-label="Highest colour elevation"
            min={zMin}
            max={zMax}
            step={step}
            value={range.max}
            onChange={(e) => setMax(e.target.valueAsNumber)}
          />
        </div>
        <div className="ramp-strip" style={{ background: jetCssGradient().replace("to top", "to right") }} />
        <div className="range-extent mono">
          <span>{zMin.toFixed(2)} m</span>
          <span>{zMax.toFixed(2)} m</span>
        </div>
      </section>

      <ul className="mode-list">
        {OTHER_MODES.map((m) => (
          <li key={m} aria-disabled="true">
            <span>{m}</span>
            <span className="mode-na">Not in this scan</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
