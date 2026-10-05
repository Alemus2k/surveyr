import { useMemo } from "react";
import { normalize, terrainRamp, type RGB255 } from "../color";
import { hexToRgb } from "../appearance/colorMath";
import { MapViewer, type ColorFn } from "../components/MapViewer";
import type { Analysis } from "../types";
import { PanelSection } from "./SidePanel";

// ------------------------------------------------------------------ 2D maps

const LEVEL: RGB255 = [62, 207, 122];
const NOT_LEVEL: RGB255 = [255, 107, 107];

interface MapsPanelProps {
  analysis: Analysis;
  threshold: number;
  accent: string; // highlight colour, marks revisited cells
}

export function MapsPanel({ analysis, threshold, accent }: MapsPanelProps) {
  const { maps } = analysis;
  const fns = useMemo(() => {
    const slopeMax = Math.max(...maps.slope.data.flat(), 1);
    const { r, g, b } = hexToRgb(accent);
    return {
      elev: ((v) => terrainRamp(normalize(v, maps.elevation.min ?? 0, maps.elevation.max ?? 1))) as ColorFn,
      slope: ((v) => terrainRamp(normalize(v, 0, slopeMax))) as ColorFn,
      aspect: ((v) => terrainRamp(normalize(v, 0, 360))) as ColorFn,
      cover: ((v) => (v <= 0 ? [60, 64, 72] : v < 2 ? [80, 140, 220] : [r, g, b])) as ColorFn,
    };
  }, [maps, accent]);
  const level = useMemo<ColorFn>(() => (v) => (v <= threshold ? LEVEL : NOT_LEVEL), [threshold]);

  return (
    <PanelSection>
      <div className="map-stack">
        <MapViewer title="Elevation" data={maps.elevation.data} toColor={fns.elev} />
        <MapViewer title={`Level ground (≤ ${threshold.toFixed(1)}°)`} data={maps.slope.data} toColor={level} />
        <MapViewer title="Slope" data={maps.slope.data} toColor={fns.slope} />
        <MapViewer title="Aspect (N = 0°)" data={maps.aspect.data} toColor={fns.aspect} />
        {maps.coverage && (
          <MapViewer title="Coverage (highlight = 2+ passes)" data={maps.coverage.data} toColor={fns.cover} />
        )}
      </div>
      <p className="panel-note">Gridded at {analysis.grid.cell_size} m. North is up.</p>
    </PanelSection>
  );
}
