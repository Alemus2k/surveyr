import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { niceStep } from "../viewer/backdrop";
import { pointInPolygon, type Surfaces } from "./progress";
import { mix, siteTint, tintScale, workMask, type RGB, type SiteColorMode } from "./siteColors";
import type { Zone } from "./types";

export type MapMode = SiteColorMode;

interface SiteMapProps {
  surfaces: Surfaces;
  scan: number; // index into surfaces.scans
  mode: MapMode;
  tolerance: number;
  changeThreshold: number;
  zones: Zone[];
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
  drawing: boolean;
  onDrawn: (polygon: [number, number][]) => void;
  onDrawCancel: () => void;
  onDeleteZone: (id: string) => void; // Delete key on the selected zone
}

const RAMP: RGB[] = [[38, 70, 160], [40, 160, 190], [120, 200, 110], [235, 210, 90], [215, 110, 60]];
const CLOSE_PX = 12; // clicking this near the first vertex closes the polygon

function ramp(t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

/** Simple hillshade (light from the north-west), 0..1, NaN where unscanned. */
function hillshade(z: Float64Array, nx: number, ny: number, cell: number): Float64Array {
  const out = new Float64Array(z.length).fill(NaN);
  const at = (c: number, r: number, fallback: number) => {
    if (c < 0 || r < 0 || c >= nx || r >= ny) return fallback;
    const v = z[r * nx + c];
    return Number.isFinite(v) ? v : fallback;
  };
  const lx = -0.5, ly = 0.5, lz = 0.707; // unit-ish light vector (x east, y north, up)
  for (let r = 0; r < ny; r++) {
    for (let c = 0; c < nx; c++) {
      const v = z[r * nx + c];
      if (!Number.isFinite(v)) continue;
      const dzdx = (at(c + 1, r, v) - at(c - 1, r, v)) / (2 * cell);
      const dzdy = (at(c, r + 1, v) - at(c, r - 1, v)) / (2 * cell);
      const len = Math.hypot(dzdx, dzdy, 1);
      out[r * nx + c] = Math.max(0, (-dzdx * lx - dzdy * ly + lz) / len);
    }
  }
  return out;
}

/** Plan view of the site (north up) at one scan, coloured by the chosen comparison. */
export function SiteMap(props: SiteMapProps) {
  const { surfaces: s, scan, mode, tolerance, changeThreshold, zones, selectedZone, onSelectZone, drawing, onDrawn, onDrawCancel, onDeleteZone } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ c: number; r: number; gx: number; gy: number; px: number; py: number; left: boolean; up: boolean } | null>(null);
  const [draft, setDraft] = useState<[number, number][]>([]); // grid coords (col, row-from-top)
  const z = s.scans[scan];
  const prev = scan > 0 ? s.scans[scan - 1] : null;

  const shade = useMemo(() => hillshade(z, s.nx, s.ny, s.cell), [z, s]);
  const range = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const v of z) if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const diffs: number[] = [];
    const ref = mode === "design" ? s.design : mode === "change" ? prev : null;
    if (ref) for (let i = 0; i < z.length; i++) {
      const d = z[i] - ref[i];
      if (Number.isFinite(d)) diffs.push(Math.abs(d));
    }
    return { lo, hi, maxAbs: tintScale(diffs) };
  }, [z, prev, s.design, mode]);

  // ground that needed work at the first scan: only there does "on grade" mean "finished"
  const needsWork = useMemo(() => workMask(s.scans[0], s.design, tolerance), [s, tolerance]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    cv.width = s.nx;
    cv.height = s.ny;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(s.nx, s.ny);
    const ref = mode === "design" ? s.design : mode === "change" ? prev : null;
    const deadband = mode === "design" ? tolerance : changeThreshold;
    for (let r = 0; r < s.ny; r++) {
      for (let c = 0; c < s.nx; c++) {
        const i = r * s.nx + c;
        const h = shade[i];
        if (!Number.isFinite(h)) continue;
        const grey = 70 + 150 * h;
        let rgb: RGB = [grey, grey, grey];
        if (mode === "elevation") {
          rgb = mix(ramp((z[i] - range.lo) / (range.hi - range.lo || 1)), [0, 0, 0], 0.55 * (1 - h));
        } else if (ref) {
          const tint = siteTint(mode, z[i] - ref[i], deadband, range.maxAbs, !!needsWork?.[i]);
          if (tint) rgb = mix(rgb, tint.rgb, tint.t);
        }
        const o = ((s.ny - 1 - r) * s.nx + c) * 4; // grid row 0 is south; canvas row 0 is the top
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [z, prev, shade, mode, range, s, tolerance, changeThreshold, needsWork]);

  useEffect(() => {
    if (!drawing) setDraft([]);
  }, [drawing]);

  // world <-> grid coordinates (grid y runs down from the north edge, like the canvas)
  const toGrid = ([e, n]: [number, number]): [number, number] => [(e - s.x0) / s.cell, s.ny - (n - s.y0) / s.cell];
  const toWorld = ([gx, gy]: [number, number]): [number, number] => [s.x0 + gx * s.cell, s.y0 + (s.ny - gy) * s.cell];

  const eventGrid = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    return { gx: (px / rect.width) * s.nx, gy: (py / rect.height) * s.ny, px, py, w: rect.width, h: rect.height };
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const { gx, gy, px, py, w, h } = eventGrid(e);
    const c = Math.floor(gx), r = s.ny - 1 - Math.floor(gy);
    if (c < 0 || r < 0 || c >= s.nx || r >= s.ny) return setHover(null);
    // keep the readout inside the map: flip it left / above the cursor near the far edges
    setHover({ c, r, gx, gy, px, py, left: px > w - 200, up: py > h - 130 });
  };

  const finish = (raw: [number, number][]) => {
    // a double-click also lands as clicks: drop corners repeated on the same spot
    const pts = raw.filter((p, k) => k === 0 || Math.hypot(p[0] - raw[k - 1][0], p[1] - raw[k - 1][1]) > 0.5);
    if (pts.length >= 3) onDrawn(pts.map((p) => toWorld(p)).map(([e, n]) => [Math.round(e * 100) / 100, Math.round(n * 100) / 100]));
    else onDrawCancel();
    setDraft([]);
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const { gx, gy, w } = eventGrid(e);
    if (!drawing) {
      const [east, north] = toWorld([gx, gy]);
      const hit = [...zones].reverse().find((zn) => pointInPolygon(east, north, zn.polygon));
      onSelectZone(hit?.id ?? null);
      return;
    }
    if (e.detail >= 2) return finish(draft); // second click of a double-click: its first click placed the corner
    if (draft.length >= 3) {
      const [fx, fy] = draft[0];
      const pxPerCell = w / s.nx;
      if (Math.hypot(fx - gx, fy - gy) * pxPerCell < CLOSE_PX) return finish(draft);
    }
    setDraft((d) => [...d, [gx, gy]]);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!drawing) {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedZone) {
        e.preventDefault();
        onDeleteZone(selectedZone);
      } else if (e.key === "Escape") onSelectZone(null);
      return;
    }
    if (e.key === "Escape") {
      setDraft([]);
      onDrawCancel();
    } else if (e.key === "Enter") finish(draft);
    else if (e.key === "Backspace") setDraft((d) => d.slice(0, -1));
  };

  // hover readout
  const i = hover ? hover.r * s.nx + hover.c : -1;
  const at = (a: Float64Array | null) => (a && i >= 0 && Number.isFinite(a[i]) ? a[i] : null);
  const elev = at(z), dsg = at(s.design), before = at(prev);
  const [he, hn] = hover ? [s.x0 + (hover.c + 0.5) * s.cell, s.y0 + (hover.r + 0.5) * s.cell] : [0, 0];
  const hoverZone = hover ? [...zones].reverse().find((zn) => pointInPolygon(he, hn, zn.polygon)) : undefined;
  const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} m`;

  // scale bar: a round length about a fifth of the map width
  const widthM = s.nx * s.cell;
  const bar = niceStep(widthM / 5);

  return (
    <div className="site-map" style={{ aspectRatio: `${s.nx} / ${s.ny}` }} data-drawing={drawing || undefined}>
      <canvas ref={canvas} aria-label="Site plan, north up" />
      <svg
        ref={svg}
        viewBox={`0 0 ${s.nx} ${s.ny}`}
        preserveAspectRatio="none"
        tabIndex={0}
        aria-label={drawing ? "Click to add zone corners; Enter to finish, Escape to cancel" : "Site plan: click a zone to select it"}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onKeyDown={onKey}
      >
        {zones.map((zn) => (
          <polygon
            key={zn.id}
            points={zn.polygon.map((p) => toGrid(p).join(",")).join(" ")}
            className="site-zone"
            data-selected={zn.id === selectedZone || undefined}
            style={{ stroke: zn.color, fill: zn.color }}
          />
        ))}
        {drawing && draft.length > 0 && (
          <polyline
            className="site-draft"
            points={[...draft, ...(hover ? [[hover.gx, hover.gy]] : [])].map((p) => p.join(",")).join(" ")}
          />
        )}
      </svg>
      {zones.map((zn) => {
        const g = zn.polygon.map(toGrid);
        const cx = g.reduce((a, p) => a + p[0], 0) / g.length, cy = g.reduce((a, p) => a + p[1], 0) / g.length;
        return (
          <span key={zn.id} className="site-zone-label" style={{ left: `${(100 * cx) / s.nx}%`, top: `${(100 * cy) / s.ny}%` }} data-selected={zn.id === selectedZone || undefined}>
            {zn.name}
          </span>
        );
      })}
      <div className="site-map-north" aria-hidden="true">N ↑</div>
      <div className="site-map-scale" aria-hidden="true">
        <i style={{ width: `${(100 * bar) / widthM}%` }} />
        <span className="mono">{bar} m</span>
      </div>
      {hover && !drawing && (
        <div
          className="site-readout mono"
          style={{
            left: hover.px + (hover.left ? -14 : 14),
            top: hover.py + (hover.up ? -14 : 14),
            transform: `translate(${hover.left ? "-100%" : "0"}, ${hover.up ? "-100%" : "0"})`,
          }}
        >
          {hoverZone && <div className="site-readout-zone">{hoverZone.name}</div>}
          <div>
            <span>E</span>
            <span>{he.toFixed(1)}</span>
          </div>
          <div>
            <span>N</span>
            <span>{hn.toFixed(1)}</span>
          </div>
          <div>
            <span>Elevation</span>
            <span>{elev === null ? "—" : `${elev.toFixed(2)} m`}</span>
          </div>
          {dsg !== null && (
            <div>
              <span>vs design</span>
              <span className={elev === null ? "" : Math.abs(elev - dsg) <= tolerance ? "ok" : elev > dsg ? "cut" : "fill"}>
                {elev === null ? "—" : signed(elev - dsg)}
              </span>
            </div>
          )}
          {prev && (
            <div>
              <span>since last scan</span>
              <span>{elev === null || before === null ? "—" : signed(elev - before)}</span>
            </div>
          )}
        </div>
      )}
      {drawing && (
        <div className="site-draw-hint">
          {draft.length < 3 ? "Click to place zone corners" : "Click the first corner, double-click or press Enter to finish"} · Esc cancels
        </div>
      )}
    </div>
  );
}
