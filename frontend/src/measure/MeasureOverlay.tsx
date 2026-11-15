import { useEffect, useMemo, useRef, useState } from "react";
import { formatArea, quantityText, useUnitSystem } from "../lib/units";
import type { ViewerScene } from "../viewer/scene";
import { measureDistance, measureSurface, polygonArea, type Vec3 } from "./geometry";
import type { MeasureLayer, OverlayShape } from "./layer";
import { MeasureIcon } from "./MeasureGroup";
import {
  allMeasurementsText,
  gradeText,
  measurementTag,
  measurementText,
  measurementTitle,
  pathLegs,
  resultNotes,
  resultRows,
  sceneLabel,
} from "./report";
import { formatLength, formatSmall } from "../lib/units";
import { MIN_POINTS, type Measurement, type MeasureMode, type MeasureState } from "./state";
import type { MeasureController } from "./useMeasure";
import "./measure.css";

const CLICK_SLOP_PX = 5; // a press that moves further is an orbit drag, not a click
const CLICK_MAX_MS = 700;
const DOUBLE_MS = 400;
const DOUBLE_PX = 6;
const CLOSE_PX = 10; // clicking this close to the first spot closes an area
const MAX_SURFACE_SAMPLES = 5000;
const MIN_SURFACE_SAMPLES = 50;

/** Where a shape's label sits: the point, the middle of a distance, the last spot of a path, the outline's centre. */
function labelAt(kind: MeasureMode, pts: Vec3[]): Vec3 {
  if (kind === "distance" && pts.length >= 2) {
    const [a, b] = pts;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }
  if (kind === "area" && pts.length >= 3) {
    const n = pts.length;
    return pts.reduce<Vec3>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
  }
  return pts[pts.length - 1];
}

function shapeOf(m: Measurement, selected: boolean): OverlayShape {
  return {
    key: String(m.id),
    points: m.points,
    closed: m.kind === "area",
    fill: m.kind === "area",
    tag: measurementTag(m),
    label: sceneLabel(m),
    labelAt: labelAt(m.kind, m.points),
    emphasis: selected,
  };
}

function draftShape(mode: MeasureMode, pts: Vec3[]): OverlayShape | null {
  if (pts.length < 2) return null;
  let label: string | null = null;
  if (mode === "distance" || mode === "path") {
    label = sceneLabel({ kind: mode === "distance" ? "distance" : "path", points: pts });
  } else if (mode === "area" && pts.length >= 3) {
    label = quantityText(formatArea(polygonArea(pts)));
  }
  return {
    key: "draft",
    points: pts,
    closed: mode === "area",
    fill: mode === "area",
    tag: null,
    label,
    labelAt: labelAt(mode, pts),
    emphasis: true,
  };
}

function instructions(mode: MeasureMode, n: number): string {
  if (mode === "point") return "Click the ground to read its elevation and coordinates.";
  if (mode === "distance") return n === 0 ? "Click the first spot." : "Click the second spot.";
  if (mode === "path") return n === 0 ? "Click where the route starts." : "Click to add spots. Double-click or press Enter to finish.";
  if (n < MIN_POINTS.area) return `Click around the outline (${n} of at least 3 spots).`;
  return "Keep clicking around the outline. Double-click, press Enter or click the first spot to finish.";
}

interface Props {
  scene: ViewerScene;
  controller: MeasureController;
}

/** Picking, drawing and the results panel for the measuring tools inside a 3D viewport. */
export function MeasureOverlay({ scene, controller }: Props) {
  const { state, dispatch } = controller;
  const units = useUnitSystem(); // labels are re-read on a switch
  const active = state.mode !== null || state.items.length > 0;
  const layer = useMemo<MeasureLayer | null>(() => (active ? scene.measure() : null), [active, scene]);
  const [hover, setHover] = useState<Vec3 | null>(null);
  const stateRef = useRef<MeasureState>(state);
  stateRef.current = state;

  // ---- pointer + keyboard while a tool is on
  useEffect(() => {
    if (!layer || !state.mode) return;
    const canvas = layer.canvas;
    layer.setCursor("crosshair");
    let down: { x: number; y: number; t: number } | null = null;
    let last: { x: number; y: number; t: number } | null = null;
    let raf = 0;
    let moveAt: { x: number; y: number } | null = null;

    const click = (x: number, y: number, t: number) => {
      const s = stateRef.current;
      if (!s.mode) return;
      const prev = last;
      last = { x, y, t };
      if (prev && t - prev.t < DOUBLE_MS && Math.hypot(x - prev.x, y - prev.y) < DOUBLE_PX) {
        last = null;
        if (s.mode === "path" || s.mode === "area") dispatch({ type: "finish" });
        return; // the second click of a double-click never adds a spot
      }
      if (s.mode === "area" && s.draft.length >= MIN_POINTS.area) {
        const first = layer.project(s.draft[0]);
        if (first && Math.hypot(first.x - x, first.y - y) < CLOSE_PX) {
          dispatch({ type: "finish" });
          return;
        }
      }
      const p = layer.pick(x, y);
      if (p) dispatch({ type: "add", point: p });
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX || e.timeStamp - d.t > CLICK_MAX_MS) return;
      click(e.clientX, e.clientY, e.timeStamp);
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return; // orbiting: don't chase the cursor
      moveAt = { x: e.clientX, y: e.clientY };
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (moveAt) setHover(layer.pick(moveAt.x, moveAt.y));
        });
    };
    const onLeave = () => {
      moveAt = null;
      setHover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") dispatch({ type: "cancel" });
      else if (e.key === "Backspace") dispatch({ type: "undo" });
      else if (e.key === "Enter") dispatch({ type: "finish" });
      else return;
      e.preventDefault();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      layer.setCursor("");
      setHover(null);
    };
  }, [layer, state.mode, dispatch]);

  // ---- areas: surface area and average elevation over the ground, once per outline
  useEffect(() => {
    if (!layer) return;
    const todo = state.items.find((m) => m.kind === "area" && !m.surface);
    if (!todo) return;
    const timer = window.setTimeout(() => {
      const plan = polygonArea(todo.points);
      // ≈ 2 point spacings (the ground snap's own footprint), coarser on big outlines, finer on tiny ones
      const cell = Math.min(
        Math.max(2 * layer.spacing, Math.sqrt(plan / MAX_SURFACE_SAMPLES)),
        Math.max(Math.sqrt(plan / MIN_SURFACE_SAMPLES), 0.05)
      );
      dispatch({ type: "surface", id: todo.id, surface: measureSurface(todo.points, layer.groundAt, cell) });
    }, 0); // after the "working…" row has painted
    return () => window.clearTimeout(timer);
  }, [layer, state.items, dispatch]);

  // ---- drawing
  useEffect(() => {
    layer?.setShapes(state.items.map((m) => shapeOf(m, m.id === state.selected)));
  }, [layer, state.items, state.selected, units]);
  const draftPts = useMemo(() => (hover && state.mode && state.mode !== "point" ? [...state.draft, hover] : state.draft), [state.draft, state.mode, hover]);
  useEffect(() => {
    layer?.setDraft(state.mode ? draftShape(state.mode, draftPts) : null);
  }, [layer, state.mode, draftPts, units]);
  useEffect(() => layer?.setHover(state.mode ? hover : null), [layer, state.mode, hover]);

  if (!active) return null;
  return <MeasurePanel state={state} controller={controller} hover={hover} />;
}

// ---------------------------------------------------------------- panel

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => setCopied(key),
      () => setCopied(`${key}:failed`)
    );
  };
  return [copied, copy];
}

function LiveReadout({ mode, draft, hover }: { mode: MeasureMode; draft: Vec3[]; hover: Vec3 | null }) {
  if (!hover) return null;
  if (mode === "point" || draft.length === 0) {
    return <p className="measure-live mono">Under cursor: {resultRows({ kind: "point", points: [hover] })[0].value}</p>;
  }
  if (mode === "area") return null;
  const leg = measureDistance(draft[draft.length - 1], hover);
  return (
    <p className="measure-live mono">
      {mode === "path" ? "This leg" : "So far"}: {formatLength(leg.horizontal)} · {gradeText(leg)}
    </p>
  );
}

function MeasurePanel({ state, controller, hover }: { state: MeasureState; controller: MeasureController; hover: Vec3 | null }) {
  const { dispatch } = controller;
  const [copied, copy] = useCopy();
  const [confirmClear, setConfirmClear] = useState(false);
  const { mode, items, draft, selected } = state;

  return (
    <section className="measure-panel" aria-label="Measurements">
      <header className="measure-head">
        <h3>Measurements</h3>
        {items.length > 0 && !confirmClear && (
          <div className="measure-head-actions">
            <button className="measure-text-btn" onClick={() => copy("all", allMeasurementsText(items))}>
              {copied === "all" ? "Copied" : copied === "all:failed" ? "Couldn't copy" : "Copy"}
            </button>
            <button className="measure-text-btn" onClick={() => setConfirmClear(true)}>
              Clear
            </button>
          </div>
        )}
        {confirmClear && (
          <div className="measure-head-actions">
            <span className="measure-confirm">Clear all {items.length}?</span>
            <button
              className="measure-text-btn is-danger"
              onClick={() => {
                dispatch({ type: "clear" });
                setConfirmClear(false);
              }}
            >
              Clear
            </button>
            <button className="measure-text-btn" onClick={() => setConfirmClear(false)}>
              Keep
            </button>
          </div>
        )}
      </header>

      {mode && (
        <div className="measure-status">
          <p className="measure-instr">
            <MeasureIcon mode={mode} />
            <span>{instructions(mode, draft.length)}</span>
          </p>
          <LiveReadout mode={mode} draft={draft} hover={hover} />
          <p className="measure-keys">
            {draft.length > 0 ? "Backspace removes the last spot · Esc cancels" : "Esc turns the tool off"}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        !mode && <p className="measure-empty">Pick a measuring tool in the toolbar.</p>
      ) : (
        <ul className="measure-list">
          {[...items].reverse().map((m) => {
            const open = m.id === selected;
            const title = measurementTitle(m);
            return (
              <li key={m.id} className={`measure-item${open ? " is-open" : ""}`}>
                <div className="measure-item-head">
                  <button
                    className="measure-item-title"
                    aria-expanded={open}
                    onClick={() => dispatch({ type: "select", id: open ? null : m.id })}
                  >
                    <span className="measure-tag mono">{measurementTag(m)}</span>
                    <span className="measure-item-name">{title}</span>
                    <span className="measure-item-sum mono">{sceneLabel(m)}</span>
                  </button>
                  <button
                    className="measure-icon-btn"
                    title={`Copy ${title} as text`}
                    aria-label={`Copy ${title}`}
                    onClick={() => copy(String(m.id), measurementText(m))}
                  >
                    {copied === String(m.id) ? "✓" : <CopyGlyph />}
                  </button>
                  <button
                    className="measure-icon-btn"
                    title={`Delete ${title}`}
                    aria-label={`Delete ${title}`}
                    onClick={() => dispatch({ type: "remove", id: m.id })}
                  >
                    <CloseGlyph />
                  </button>
                </div>
                {open && <MeasureDetail m={m} />}
              </li>
            );
          })}
        </ul>
      )}

      <p className="measure-foot">
        Elevations are the ground under the cursor (middle of the 9 nearest scan points), true height — never the
        stretched 3D view. Good to about ±{formatSmall(0.05)} (drone LiDAR is ±2–5 cm vertical).
      </p>
    </section>
  );
}

function MeasureDetail({ m }: { m: Measurement }) {
  const rows = resultRows(m);
  const notes = resultNotes(m);
  return (
    <div className="measure-detail">
      <dl className="measure-rows">
        {rows.map((r) => (
          <div key={r.label} title={r.hint}>
            <dt>{r.label}</dt>
            <dd className="mono">{r.value}</dd>
          </div>
        ))}
      </dl>
      {m.kind === "path" && (
        <table className="measure-legs">
          <thead>
            <tr>
              <th>Leg</th>
              <th>Horizontal</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {pathLegs(m.points).map((l, i) => (
              <tr key={i} className={l.warn ? "is-warn" : undefined} title={l.warn ? "Short leg: its grade is mostly scan noise" : undefined}>
                <td>{i + 1}</td>
                <td className="mono">{l.horizontal}</td>
                <td className="mono">{l.grade}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {notes.map((n) => (
        <p key={n} className="measure-note">
          {n}
        </p>
      ))}
    </div>
  );
}

const CopyGlyph = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
    <path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" />
  </svg>
);
const CloseGlyph = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
