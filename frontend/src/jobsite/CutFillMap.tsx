import { useEffect, useRef } from "react";
import type { SiteCells } from "./earthworks";

interface CutFillMapProps {
  site: SiteCells;
  target: Float64Array; // pad elevation per scanned cell
  nx: number;
  ny: number;
}

const ON_GRADE_M = 0.01; // within 1 cm counts as already on grade
const CUT: [number, number, number] = [239, 75, 75];
const FILL: [number, number, number] = [77, 157, 255];
const NEUTRAL: [number, number, number] = [128, 134, 145];

/** Plan view of where to dig (red) and where to fill (blue); north up. */
export function CutFillMap({ site, target, nx, ny }: CutFillMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  let maxAbs = ON_GRADE_M;
  for (let i = 0; i < site.z.length; i++) maxAbs = Math.max(maxAbs, Math.abs(site.z[i] - target[i]));

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || nx === 0 || ny === 0) return;
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(nx, ny); // unscanned cells stay transparent
    for (let i = 0; i < site.z.length; i++) {
      const d = site.z[i] - target[i];
      const t = Math.min(1, Math.abs(d) / maxAbs);
      const base = Math.abs(d) < ON_GRADE_M ? NEUTRAL : d > 0 ? CUT : FILL;
      const strength = Math.abs(d) < ON_GRADE_M ? 0.55 : 0.35 + 0.65 * t;
      const row = ny - 1 - site.iy[i]; // grid row 0 is south; canvas row 0 is the top
      const o = (row * nx + site.ix[i]) * 4;
      img.data[o] = base[0];
      img.data[o + 1] = base[1];
      img.data[o + 2] = base[2];
      img.data[o + 3] = Math.round(255 * strength);
    }
    ctx.putImageData(img, 0, 0);
  }, [site, target, nx, ny, maxAbs]);

  return (
    <figure className="cutfill-map">
      <canvas ref={canvas} aria-label="Cut and fill map, north up" />
      <figcaption>
        <span className="legend-chip cut">Dig</span>
        <span className="legend-ramp" />
        <span className="legend-chip fill">Fill</span>
        <span className="mono legend-max">±{maxAbs.toFixed(2)} m</span>
      </figcaption>
    </figure>
  );
}
