import { useMemo, useState } from "react";
import { PointCloudViewer, type ViewRequest } from "../viewer/PointCloudViewer";
import type { ColorRange, PreparedCloud } from "../viewer/prepare";
import type { Outline, ViewPreset } from "../viewer/scene";
import { CameraGroup, SliderGroup } from "../viewer/ViewerToolbar";
import type { Surfaces } from "./progress";
import { mix, siteTint, tintScale, workMask, type RGB, type SiteColorMode } from "./siteColors";
import type { Zone } from "./types";

interface Site3DProps {
  cloud: PreparedCloud; // the selected scan's points
  elevationColors: Float32Array; // elevation ramp from the Cloud colour panel
  range: ColorRange;
  surfaces: Surfaces;
  scan: number; // index of the selected scan in surfaces
  mode: SiteColorMode;
  tolerance: number;
  changeThreshold: number;
  zones: Zone[];
  selectedZone: string | null;
  accent: string;
}

const OUTLINE_LIFT_M = 0.25; // float zone outlines just above the ground
const SAMPLE_EVERY = 10; // colour-scale estimate from every 10th point

/** Grid value under a survey point, or NaN outside the grid / where unscanned. */
function cellLookup(s: Surfaces) {
  return (grid: Float64Array, e: number, n: number) => {
    const c = Math.floor((e - s.x0) / s.cell), r = Math.floor((n - s.y0) / s.cell);
    return c < 0 || r < 0 || c >= s.nx || r >= s.ny ? NaN : grid[r * s.nx + c];
  };
}

/** The selected scan as 3D points, coloured like the plan map, with zone outlines draped on the ground. */
export function Site3D(props: Site3DProps) {
  const { cloud, elevationColors, range, surfaces: s, scan, mode, tolerance, changeThreshold, zones, selectedZone, accent } = props;
  const [view, setView] = useState<ViewRequest | null>(null);
  const [pointScale, setPointScale] = useState(1);
  const at = useMemo(() => cellLookup(s), [s]);

  const colors = useMemo(() => {
    if (mode === "elevation") return elevationColors;
    const ref = mode === "design" ? s.design : scan > 0 ? s.scans[scan - 1] : null;
    if (!ref) return elevationColors;
    const needsWork = workMask(s.scans[0], s.design, tolerance);
    const deadband = mode === "design" ? tolerance : changeThreshold;
    const { origin, positions, z, zMin, zMax } = cloud;
    // each point is compared with the reference surface in its cell, using its own elevation
    const diff = new Float64Array(cloud.count);
    const cellOf = new Int32Array(cloud.count);
    const sample: number[] = [];
    for (let i = 0; i < cloud.count; i++) {
      const e = origin.x + positions[i * 3], n = origin.y - positions[i * 3 + 2];
      const c = Math.floor((e - s.x0) / s.cell), r = Math.floor((n - s.y0) / s.cell);
      cellOf[i] = c < 0 || r < 0 || c >= s.nx || r >= s.ny ? -1 : r * s.nx + c;
      diff[i] = cellOf[i] < 0 ? NaN : z[i] - ref[cellOf[i]];
      if (i % SAMPLE_EVERY === 0 && Number.isFinite(diff[i])) sample.push(Math.abs(diff[i]));
    }
    const scale = tintScale(sample);
    const rgb = new Float32Array(cloud.count * 3);
    for (let i = 0; i < cloud.count; i++) {
      const g = 95 + 110 * ((z[i] - zMin) / (zMax - zMin || 1)); // grey by height keeps the terrain readable
      let c: RGB = [g, g, g];
      const tint = siteTint(mode, diff[i], deadband, scale, cellOf[i] >= 0 && !!needsWork?.[cellOf[i]]);
      if (tint) c = mix(c, tint.rgb, tint.t);
      rgb[i * 3] = c[0] / 255;
      rgb[i * 3 + 1] = c[1] / 255;
      rgb[i * 3 + 2] = c[2] / 255;
    }
    return rgb;
  }, [cloud, elevationColors, s, scan, mode, tolerance, changeThreshold]);

  // zone outlines, densified so they follow the ground between corners
  const outlines = useMemo<Outline[]>(() => {
    const ground = s.scans[scan];
    const step = s.cell * 2;
    return zones.map((zn) => {
      const pts: [number, number, number][] = [];
      let last = cloud.zMax;
      zn.polygon.forEach(([x1, y1], k) => {
        const [x2, y2] = zn.polygon[(k + 1) % zn.polygon.length];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
        for (let j = 0; j < n; j++) {
          const e = x1 + ((x2 - x1) * j) / n, nn = y1 + ((y2 - y1) * j) / n;
          const g = at(ground, e, nn);
          if (Number.isFinite(g)) last = g; // carry the last ground height across unscanned gaps
          pts.push([e, nn, last + OUTLINE_LIFT_M]);
        }
      });
      return { points: pts, color: zn.color, emphasis: zn.id === selectedZone };
    });
  }, [zones, selectedZone, s, scan, at, cloud.zMax]);

  const goTo = (preset: ViewPreset) => setView((v) => ({ preset, n: (v?.n ?? 0) + 1 }));

  return (
    <div className="site-3d">
      <PointCloudViewer
        cloud={cloud}
        colors={colors}
        range={range}
        pointScale={pointScale}
        showGrid
        slice={null}
        view={view}
        accent={accent}
        renderMode="points"
        surfaceGrid={null}
        surfaceOpacity={1}
        onTopView={() => goTo("top")}
        outlines={outlines}
        legend={mode === "elevation" ? undefined : false /* the dashboard's legend explains the tints */}
        toolbar={
          <>
            <CameraGroup onView={goTo} />
            <SliderGroup label="Point size" icon="points" min={0.4} max={3} step={0.1} value={pointScale} onChange={setPointScale} />
          </>
        }
      />
    </div>
  );
}
