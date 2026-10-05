import { useMemo, useState } from "react";
import { PanelSection } from "../panels/SidePanel";
import type { Analysis } from "../types";
import { AspectRoseChart } from "./AspectRoseChart";
import { DistributionChart, type ChartKind } from "./DistributionChart";
import { EarthworksChart } from "./EarthworksChart";
import { SlopeClassesChart } from "./SlopeClassesChart";
import { aspectRose, earthworksCurve, maskedValues, percentAtOrBelow, slopeClasses } from "./terrainStats";

const KINDS: ReadonlyArray<[ChartKind, string]> = [
  ["histogram", "Histogram"],
  ["area", "Area"],
  ["cumulative", "Cumulative"],
];
const SLOPE_CLASS_EDGES = [0, 2, 5, 10, 15, Infinity]; // degrees; common grading bands
const ROSE_SECTORS = 16;
const ROSE_MIN_SLOPE = 1; // degrees; flatter ground has no meaningful direction
const SLOPE_COLOR = "#4d9dff";

interface ChartsPanelProps {
  analysis: Analysis;
  accent: string;
  threshold: number;
}

/** Charts for the open scan, all over scanned ground only. */
export function ChartsPanel({ analysis, accent, threshold }: ChartsPanelProps) {
  const [kind, setKind] = useState<ChartKind>("histogram");
  const { maps, grid } = analysis;
  const mask = maps.mask?.data;

  const series = useMemo(() => {
    const z = maskedValues(maps.elevation.data, mask);
    const slope = maskedValues(maps.slope.data, mask);
    const aspect = maskedValues(maps.aspect.data, mask);
    return {
      slope,
      earthworks: earthworksCurve(z, grid.cell_size),
      classes: slopeClasses(slope, SLOPE_CLASS_EDGES),
      rose: aspectRose(aspect, slope, ROSE_SECTORS, ROSE_MIN_SLOPE),
    };
  }, [analysis]);

  const pct = (v: number) => `${Math.round(v)}%`;
  // counts are integers; axis edges are fractional metres/degrees
  const num = (digits: number) => (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));

  return (
    <>
      <PanelSection label="Earthworks balance">
        <EarthworksChart curve={series.earthworks} />
      </PanelSection>

      <PanelSection label="Slope classes">
        <SlopeClassesChart
          classes={series.classes}
          threshold={threshold}
          levelPct={percentAtOrBelow(series.slope, threshold)}
        />
      </PanelSection>

      <PanelSection label="Aspect (which way slopes face)">
        <AspectRoseChart rose={series.rose} color={accent} minSlope={ROSE_MIN_SLOPE} />
      </PanelSection>

      <PanelSection label="Distributions">
        <div className="segmented" role="group" aria-label="Distribution chart type">
          {KINDS.map(([k, label]) => (
            <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <h4 className="chart-title">Elevation</h4>
        <DistributionChart
          data={analysis.histograms.elevation}
          kind={kind}
          color={accent}
          unit="m"
          format={kind === "cumulative" ? pct : num(2)}
        />
        <h4 className="chart-title">Slope</h4>
        <DistributionChart
          data={analysis.histograms.slope}
          kind={kind}
          color={SLOPE_COLOR}
          unit="°"
          format={kind === "cumulative" ? pct : num(1)}
        />
      </PanelSection>
    </>
  );
}
