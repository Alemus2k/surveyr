// A reusable plan view of a job site (north up) for dashboard tabs: shaded
// relief underneath, the caller's colour layer on top, then outlines, markers,
// a hover readout and an optional draw-a-shape tool. The Progress tab's own
// map (SiteMap) predates this; new tabs should use PlanView.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { formatCoordinate, niceLengthStep } from "../lib/units";
import type { RGB } from "./siteColors";

export interface PlanGrid {
  nx: number;
  ny: number;
  cell: number; // metres
  x0: number; // easting / northing of the south-west corner
  y0: number;
}

/** An outline or line on the plan, in survey coordinates. */
export interface PlanShape {
  id: string;
  points: [number, number][];
  color: string;
  closed?: boolean; // default true (a polygon); false = a line
  label?: string;
  dashed?: boolean;
  selected?: boolean;
  fill?: boolean; // default: closed shapes get a faint fill
}

export interface PlanMarker {
  id: string;
  e: number;
  n: number;
  label?: string;
  title?: string; // tooltip
  tone?: "good" | "warn" | "bad" | "info";
}

/** One line of the hover readout. */
export interface ReadoutRow {
  label: string;
  value: string;
  tone?: "cut" | "fill" | "ok";
}

interface PlanViewProps {
  grid: PlanGrid;
  /** Ground surface for the grey shaded-relief base (row-major, row 0 = south, NaN = not scanned). */
  relief?: Float64Array | null;
  /** RGBA per cell (nx·ny·4, row 0 = south), blended over the relief by its alpha. Build it with paintLayer(). */
  layer?: Uint8ClampedArray | null;
  shapes?: PlanShape[];
  markers?: PlanMarker[];
  /** Rows for the hover readout at cell ``i`` (centre at e, n); E and N are added for you. */
  readout?: (i: number, e: number, n: number) => ReadoutRow[];
  title?: (i: number, e: number, n: number) => string | null; // heading of the readout, e.g. a zone's name
  onPick?: (e: number, n: number, i: number) => void; // a click when not drawing
  onPickShape?: (id: string | null) => void; // a click on / off a closed shape
  /** Turn the view into a drawing tool: click to add points; double-click, Enter or (polygons) the first point finishes. */
  draw?: { kind: "polygon" | "line"; hint?: string; onDone: (points: [number, number][]) => void; onCancel: () => void } | null;
  ariaLabel?: string;
}

const CLOSE_PX = 12; // clicking this near the first vertex closes a polygon

/** Simple hillshade (light from the north-west), 0..1, NaN where unscanned. */
export function hillshade(z: Float64Array, nx: number, ny: number, cell: number): Float64Array {
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

/**
 * Build a colour layer for PlanView: ``colour(i)`` returns [r, g, b, strength 0..1]
 * for cell ``i`` (row-major, row 0 = south) or null to leave the relief showing.
 */
export function paintLayer(cells: number, colour: (i: number) => [number, number, number, number] | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cells * 4);
  for (let i = 0; i < cells; i++) {
    const c = colour(i);
    if (!c) continue;
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, c[3])));
  }
  return out;
}

export function pointInShape(e: number, n: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > n !== yj > n && e < xi + ((n - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
  }
  return inside;
}

export function PlanView(props: PlanViewProps) {
  const { grid: g, relief, layer, shapes = [], markers = [], readout, title, onPick, onPickShape, draw, ariaLabel } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ c: number; r: number; gx: number; gy: number; px: number; py: number; left: boolean; up: boolean } | null>(null);
  const [draft, setDraft] = useState<[number, number][]>([]); // grid coords (col, row-from-top)
  const shade = useMemo(() => (relief ? hillshade(relief, g.nx, g.ny, g.cell) : null), [relief, g.nx, g.ny, g.cell]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    cv.width = g.nx;
    cv.height = g.ny;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(g.nx, g.ny);
    for (let r = 0; r < g.ny; r++) {
      for (let c = 0; c < g.nx; c++) {
        const i = r * g.nx + c;
        const h = shade ? shade[i] : 0.5;
        const a = layer ? layer[i * 4 + 3] / 255 : 0;
        if (!Number.isFinite(h) && a === 0) continue; // nothing scanned, nothing painted
        const grey: RGB = Number.isFinite(h) ? [52 + 128 * h, 52 + 128 * h, 52 + 128 * h] : [30, 32, 36];
        const o = ((g.ny - 1 - r) * g.nx + c) * 4; // grid row 0 is south; canvas row 0 is the top
        for (let k = 0; k < 3; k++) img.data[o + k] = layer ? grey[k] + (layer[i * 4 + k] - grey[k]) * a : grey[k];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [shade, layer, g.nx, g.ny]);

  useEffect(() => {
    if (!draw) setDraft([]);
  }, [draw === null || draw === undefined]);

  // world <-> grid coordinates (grid y runs down from the north edge, like the canvas)
  const toGrid = ([e, n]: [number, number]): [number, number] => [(e - g.x0) / g.cell, g.ny - (n - g.y0) / g.cell];
  const toWorld = ([gx, gy]: [number, number]): [number, number] => [g.x0 + gx * g.cell, g.y0 + (g.ny - gy) * g.cell];

  const eventGrid = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    return { gx: (px / rect.width) * g.nx, gy: (py / rect.height) * g.ny, px, py, w: rect.width, h: rect.height };
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const { gx, gy, px, py, w, h } = eventGrid(e);
    const c = Math.floor(gx), r = g.ny - 1 - Math.floor(gy);
    if (c < 0 || r < 0 || c >= g.nx || r >= g.ny) return setHover(null);
    // keep the readout inside the map: flip it left / above the cursor near the far edges
    setHover({ c, r, gx, gy, px, py, left: px > w - 220, up: py > h - 150 });
  };

  const finish = (raw: [number, number][]) => {
    if (!draw) return;
    // a double-click also lands as clicks: drop points repeated on the same spot
    const pts = raw.filter((p, k) => k === 0 || Math.hypot(p[0] - raw[k - 1][0], p[1] - raw[k - 1][1]) > 0.5);
    const enough = pts.length >= (draw.kind === "polygon" ? 3 : 2);
    if (enough) draw.onDone(pts.map((p) => toWorld(p)).map(([e, n]) => [Math.round(e * 100) / 100, Math.round(n * 100) / 100]));
    else draw.onCancel();
    setDraft([]);
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const { gx, gy, w } = eventGrid(e);
    if (!draw) {
      const [east, north] = toWorld([gx, gy]);
      if (onPickShape) onPickShape([...shapes].reverse().find((s) => s.closed !== false && pointInShape(east, north, s.points))?.id ?? null);
      const c = Math.floor(gx), r = g.ny - 1 - Math.floor(gy);
      if (onPick && c >= 0 && r >= 0 && c < g.nx && r < g.ny) onPick(east, north, r * g.nx + c);
      return;
    }
    if (e.detail >= 2) return finish(draft); // second click of a double-click: its first click placed the point
    if (draw.kind === "polygon" && draft.length >= 3) {
      const [fx, fy] = draft[0];
      if (Math.hypot(fx - gx, fy - gy) * (w / g.nx) < CLOSE_PX) return finish(draft);
    }
    setDraft((d) => [...d, [gx, gy]]);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!draw) return;
    if (e.key === "Escape") {
      setDraft([]);
      draw.onCancel();
    } else if (e.key === "Enter") finish(draft);
    else if (e.key === "Backspace") setDraft((d) => d.slice(0, -1));
  };

  const i = hover ? hover.r * g.nx + hover.c : -1;
  const [he, hn] = hover ? [g.x0 + (hover.c + 0.5) * g.cell, g.y0 + (hover.r + 0.5) * g.cell] : [0, 0];
  const rows = hover && readout ? readout(i, he, hn) : [];
  const heading = hover && title ? title(i, he, hn) : null;
  const widthM = g.nx * g.cell;
  const bar = niceLengthStep(widthM / 5); // a round length (in the user's unit) about a fifth of the width
  const need = draw?.kind === "polygon" ? 3 : 2;

  return (
    <div className="site-map" style={{ aspectRatio: `${g.nx} / ${g.ny}` }} data-drawing={!!draw || undefined}>
      <canvas ref={canvas} aria-label={ariaLabel ?? "Site plan, north up"} />
      <svg
        ref={svg}
        viewBox={`0 0 ${g.nx} ${g.ny}`}
        preserveAspectRatio="none"
        tabIndex={0}
        aria-label={draw ? "Click to add points; Enter to finish, Escape to cancel" : ariaLabel ?? "Site plan"}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
        onKeyDown={onKey}
      >
        {shapes.map((s) => {
          const pts = s.points.map((p) => toGrid(p).join(",")).join(" ");
          const style = { stroke: s.color, fill: s.closed !== false && s.fill !== false ? s.color : "none" };
          const common = { className: "site-zone", "data-selected": s.selected || undefined, "data-dashed": s.dashed || undefined, style };
          return s.closed === false ? <polyline key={s.id} points={pts} {...common} /> : <polygon key={s.id} points={pts} {...common} />;
        })}
        {draw && draft.length > 0 && (
          <polyline className="site-draft" points={[...draft, ...(hover ? [[hover.gx, hover.gy]] : [])].map((p) => p.join(",")).join(" ")} />
        )}
      </svg>
      {shapes.filter((s) => s.label).map((s) => {
        const pts = s.points.map(toGrid);
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        return (
          <span key={s.id} className="site-zone-label" style={{ left: `${(100 * cx) / g.nx}%`, top: `${(100 * cy) / g.ny}%` }} data-selected={s.selected || undefined}>
            {s.label}
          </span>
        );
      })}
      {markers.map((m) => {
        const [mx, my] = toGrid([m.e, m.n]);
        return (
          <span key={m.id} className={`plan-marker ${m.tone ?? "info"}`} style={{ left: `${(100 * mx) / g.nx}%`, top: `${(100 * my) / g.ny}%` }} title={m.title}>
            <i />
            {m.label && <b>{m.label}</b>}
          </span>
        );
      })}
      <div className="site-map-north" aria-hidden="true">N ↑</div>
      <div className="site-map-scale" aria-hidden="true">
        <i style={{ width: `${(100 * bar.metres) / widthM}%` }} />
        <span className="fig">{bar.label}</span>
      </div>
      {hover && !draw && (
        <div
          className="site-readout mono"
          style={{
            left: hover.px + (hover.left ? -14 : 14),
            top: hover.py + (hover.up ? -14 : 14),
            transform: `translate(${hover.left ? "-100%" : "0"}, ${hover.up ? "-100%" : "0"})`,
          }}
        >
          {heading && <div className="site-readout-zone">{heading}</div>}
          <div>
            <span>E</span>
            <span>{formatCoordinate(he)}</span>
          </div>
          <div>
            <span>N</span>
            <span>{formatCoordinate(hn)}</span>
          </div>
          {rows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <span className={row.tone}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
      {draw && (
        <div className="site-draw-hint">
          {draft.length < need ? draw.hint ?? "Click to place points" : `${draw.kind === "polygon" ? "Click the first point, double-click" : "Double-click"} or press Enter to finish`} · Esc cancels
        </div>
      )}
    </div>
  );
}
