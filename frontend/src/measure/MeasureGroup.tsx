import type { ReactNode } from "react";
import type { MeasureMode } from "./state";
import type { MeasureController } from "./useMeasure";

const ICONS: Record<MeasureMode, ReactNode> = {
  point: (
    <>
      <path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2" />
    </>
  ),
  distance: (
    <>
      <path d="M4.5 19.5 19.5 4.5" />
      <path d="M3 16.5l4.5 4.5M16.5 3l4.5 4.5" />
      <path d="M9 13.5l1.5 1.5M12 10.5l1.5 1.5" />
    </>
  ),
  path: (
    <>
      <path d="M4 18.5 9 9l6 7 5-10.5" />
      <circle cx="4" cy="18.5" r="1.6" />
      <circle cx="20" cy="5.5" r="1.6" />
    </>
  ),
  area: (
    <>
      <path d="M5 7.5 13 4l7 6.5-3.5 9.5H6.5z" strokeLinejoin="round" />
      <path d="M8.5 15.5h6M9 12h7" strokeDasharray="1.5 2" />
    </>
  ),
};

const TOOLS: { mode: MeasureMode; label: string; tip: string }[] = [
  { mode: "point", label: "Spot elevation", tip: "Spot elevation: click the ground to read its height and coordinates" },
  { mode: "distance", label: "Distance and grade", tip: "Distance and grade: click two spots" },
  { mode: "path", label: "Path length", tip: "Path length: click along a route, double-click to finish" },
  { mode: "area", label: "Area", tip: "Area: click around an outline, double-click to finish" },
];

export function MeasureIcon({ mode }: { mode: MeasureMode }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[mode]}
    </svg>
  );
}

/** Toolbar group: the four measuring tools (click the active one again to stop). */
export function MeasureGroup({ controller }: { controller: MeasureController }) {
  const { state, dispatch } = controller;
  return (
    <div className="tool-group" role="group" aria-label="Measure">
      <span className="tool-group-caption">Measure</span>
      {TOOLS.map((t) => (
        <button
          key={t.mode}
          className="tool-btn"
          aria-pressed={state.mode === t.mode}
          onClick={() => dispatch({ type: "mode", mode: t.mode })}
          title={t.tip}
          aria-label={t.label}
        >
          <MeasureIcon mode={t.mode} />
        </button>
      ))}
    </div>
  );
}
