// Open-tab bookkeeping for projects. Pure functions so the rules are testable;
// closing a tab only hides a project — deleting is a separate, explicit action.

export interface TabsState {
  open: string[];
  active: string | null;
}

export function openTab(state: TabsState, id: string): TabsState {
  return {
    open: state.open.includes(id) ? state.open : [...state.open, id],
    active: id,
  };
}

/** Close ``id``; if it was active, activate its right neighbour, else its left. */
export function closeTab(state: TabsState, id: string): TabsState {
  const idx = state.open.indexOf(id);
  if (idx < 0) return state;
  const open = state.open.filter((t) => t !== id);
  if (state.active !== id) return { open, active: state.active };
  return { open, active: open[idx] ?? open[idx - 1] ?? null };
}

/**
 * Restore saved tabs against the projects that exist now. First run opens
 * ``firstRun`` (default: everything), activating its first entry.
 */
export function reconcileTabs(saved: TabsState | null, available: string[], firstRun: string[] = available): TabsState {
  if (!saved) {
    const open = firstRun.filter((id) => available.includes(id));
    return { open, active: open[0] ?? null };
  }
  const gone = saved.open.filter((id) => !available.includes(id));
  const next = gone.reduce((state, id) => closeTab(state, id), saved);
  // a corrupt save could name an active tab that isn't open
  return next.active && next.open.includes(next.active) ? next : { ...next, active: next.open[0] ?? null };
}
