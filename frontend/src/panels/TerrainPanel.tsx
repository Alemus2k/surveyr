import { useMemo } from "react";
import { formatArea, formatLength, formatVolume, type Quantity } from "../lib/format";
import { maskedValues, percentAtOrBelow } from "../charts/terrainStats";
import type { Analysis } from "../types";
import { PanelSection } from "./SidePanel";

/** Slope presets (degrees) for "what counts as level", steepest first like a ladder. */
const PRESETS: ReadonlyArray<{ label: string; degrees: number; curve: string }> = [
  { label: "Steep", degrees: 15, curve: "M2 24 C12 24 14 5 22 5 S30 24 38 20 S48 3 56 4 S66 22 78 20" },
  { label: "Hilly", degrees: 8, curve: "M2 22 C14 22 18 10 28 10 S40 22 50 19 S64 11 78 15" },
  { label: "Gentle", degrees: 3, curve: "M2 20 C18 20 24 15 36 15 S56 20 78 18" },
  { label: "Flat", degrees: 1, curve: "M2 20 L34 20 C40 20 42 17 46 17 S50 20 56 20 L78 20" },
];
const STEP_DEG = 0.5;
const MIN_DEG = 0.5;
const MAX_DEG = 30;

interface TerrainPanelProps {
  analysis: Analysis;
  threshold: number;
  onThreshold: (deg: number) => void;
}

export function TerrainPanel({ analysis, threshold, onThreshold }: TerrainPanelProps) {
  const slopes = useMemo(() => maskedValues(analysis.maps.slope.data, analysis.maps.mask?.data), [analysis]);
  const flatPct = useMemo(() => percentAtOrBelow(slopes, threshold), [slopes, threshold]);
  const clamp = (v: number) => Math.min(MAX_DEG, Math.max(MIN_DEG, Math.round(v * 2) / 2));
  const cf = analysis.cut_fill;

  const rows: Array<[string, Quantity | string]> = [
    ["Level at ≤ threshold", { value: flatPct.toFixed(1), unit: "%" }],
    ...(analysis.coverage
      ? ([
          ["Revisited (2+ passes)", { value: analysis.coverage.revisited_pct.toFixed(1), unit: "%" }],
          ["Covered", { value: analysis.coverage.covered_pct.toFixed(0), unit: "%" }],
          ["Passes", { value: String(analysis.coverage.n_submaps), unit: "" }],
        ] as Array<[string, Quantity]>)
      : []),
    ...(analysis.dimensions
      ? ([
          [
            "Size (W × D × H)",
            `${analysis.dimensions.width_m.toFixed(2)} × ${analysis.dimensions.depth_m.toFixed(2)} × ${analysis.dimensions.height_m.toFixed(2)} m`,
          ],
        ] as Array<[string, string]>)
      : []),
    ["Relief (max − min)", formatLength(analysis.relief_m)],
    ["Area", formatArea(analysis.area_m2)],
    ["Cut", formatVolume(cf.cut)],
    ["Fill", formatVolume(cf.fill)],
    ["Net fill − cut", formatVolume(cf.net)],
    ["Lowest", formatLength(analysis.stats.min)],
    ["Highest", formatLength(analysis.stats.max)],
  ];

  return (
    <>
      <PanelSection>
        <div className="field-row">
          <label className="field-label" id="level-label">Level threshold</label>
          <div className="stepper" role="group" aria-labelledby="level-label">
            <button aria-label="Decrease" onClick={() => onThreshold(clamp(threshold - STEP_DEG))}>‹</button>
            <output>{threshold.toFixed(1)}°</output>
            <button aria-label="Increase" onClick={() => onThreshold(clamp(threshold + STEP_DEG))}>›</button>
          </div>
        </div>
        <ol className="preset-ladder" aria-label="Slope presets">
          {PRESETS.map((p) => {
            const active = Math.abs(threshold - p.degrees) < 1e-6;
            return (
              <li key={p.label}>
                <button className="preset" aria-pressed={active} onClick={() => onThreshold(p.degrees)}>
                  <span className="preset-text">
                    <span className="preset-label">{p.label}</span>
                    <span className="preset-deg mono">≤ {p.degrees}°</span>
                  </span>
                  <svg viewBox="0 0 80 28" className="preset-curve" aria-hidden="true">
                    <path d={p.curve} />
                  </svg>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="panel-note">
          Cells with slope at or under the threshold count as level ground.
        </p>
      </PanelSection>

      <PanelSection label="Site metrics">
        <dl className="metric-list">
          {rows.map(([label, q]) => (
            <div key={label} className="metric-row">
              <dt>{label}</dt>
              <dd className="mono">
                {typeof q === "string" ? q : (
                  <>
                    {q.value} <span className="unit">{q.unit}</span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <p className="panel-note">
          Cut/fill measured against the mean elevation ({formatLength(cf.target_elev_m)}).
        </p>
      </PanelSection>
    </>
  );
}
