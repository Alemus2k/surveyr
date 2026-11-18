// What the user is measuring and has measured: a pure reducer, so the click
// rules (how many points finish each kind, undo, cancel) are testable.
import type { SurfaceResult, Vec3 } from "./geometry";

export type MeasureMode = "point" | "distance" | "path" | "area";

export interface Measurement {
  id: number;
  kind: MeasureMode;
  n: number; // 1, 2, … per kind: "Distance 2"
  points: Vec3[]; // survey coordinates, ground-snapped
  /** Areas only: filled in after finishing (needs the ground index). */
  surface?: SurfaceResult;
}

export interface MeasureState {
  mode: MeasureMode | null;
  draft: Vec3[];
  items: Measurement[];
  selected: number | null;
  nextId: number;
}

export const EMPTY_MEASURE: MeasureState = { mode: null, draft: [], items: [], selected: null, nextId: 1 };

/** Points that complete a measurement on their own (null = finished by the user). */
const AUTO_FINISH: Record<MeasureMode, number | null> = { point: 1, distance: 2, path: null, area: null };
/** Fewest points a measurement can be finished with. */
export const MIN_POINTS: Record<MeasureMode, number> = { point: 1, distance: 2, path: 2, area: 3 };

export type MeasureAction =
  | { type: "mode"; mode: MeasureMode | null }
  | { type: "add"; point: Vec3 }
  | { type: "undo" } // Backspace: drop the last draft point
  | { type: "cancel" } // Esc: drop the draft, or leave the tool when there is none
  | { type: "finish" } // Enter / double-click / click on the first point
  | { type: "remove"; id: number }
  | { type: "clear" }
  | { type: "select"; id: number | null }
  | { type: "surface"; id: number; surface: SurfaceResult };

function commit(s: MeasureState): MeasureState {
  const kind = s.mode;
  if (!kind || s.draft.length < MIN_POINTS[kind]) return s;
  const n = 1 + s.items.filter((m) => m.kind === kind).reduce((hi, m) => Math.max(hi, m.n), 0);
  const item: Measurement = { id: s.nextId, kind, n, points: s.draft };
  return { ...s, draft: [], items: [...s.items, item], selected: item.id, nextId: s.nextId + 1 };
}

export function measureReducer(s: MeasureState, a: MeasureAction): MeasureState {
  switch (a.type) {
    case "mode":
      return { ...s, mode: a.mode === s.mode ? null : a.mode, draft: [] };
    case "add": {
      if (!s.mode) return s;
      const next = { ...s, draft: [...s.draft, a.point] };
      return AUTO_FINISH[s.mode] === next.draft.length ? commit(next) : next;
    }
    case "undo":
      return s.draft.length ? { ...s, draft: s.draft.slice(0, -1) } : s;
    case "cancel":
      return s.draft.length ? { ...s, draft: [] } : { ...s, mode: null };
    case "finish":
      return commit(s);
    case "remove":
      return { ...s, items: s.items.filter((m) => m.id !== a.id), selected: s.selected === a.id ? null : s.selected };
    case "clear":
      return { ...s, items: [], draft: [], selected: null };
    case "select":
      return { ...s, selected: a.id };
    case "surface":
      return { ...s, items: s.items.map((m) => (m.id === a.id ? { ...m, surface: a.surface } : m)) };
  }
}
