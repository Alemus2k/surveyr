import { useCallback, useEffect, useState } from "react";
import { loadPref, savePref } from "../lib/persist";
import { closeTab, openTab, reconcileTabs, type TabsState } from "../lib/tabs";

const STORAGE_KEY = "surveyr.tabs";

const isTabsState = (v: unknown): v is TabsState =>
  typeof v === "object" &&
  v !== null &&
  Array.isArray((v as TabsState).open) &&
  (v as TabsState).open.every((id) => typeof id === "string") &&
  ((v as TabsState).active === null || typeof (v as TabsState).active === "string");

export interface OpenTabs extends TabsState {
  select: (id: string) => void;
  close: (id: string) => void;
}

/**
 * Which projects have tabs, and which is active. Restored from the last session
 * once the project list arrives; projects that no longer exist drop out.
 */
export function useOpenTabs(projectIds: string[] | null): OpenTabs {
  const [state, setState] = useState<TabsState | null>(null);
  const idsKey = projectIds?.join("\n") ?? null;

  useEffect(() => {
    if (projectIds === null) return;
    setState((prev) => reconcileTabs(prev ?? loadPref(STORAGE_KEY, isTabsState), projectIds));
  }, [idsKey]); // keyed on the list's contents; the array identity changes every fetch

  useEffect(() => {
    if (state) savePref(STORAGE_KEY, state);
  }, [state]);

  const select = useCallback((id: string) => setState((s) => openTab(s ?? { open: [], active: null }, id)), []);
  const close = useCallback((id: string) => setState((s) => (s ? closeTab(s, id) : s)), []);

  return { open: state?.open ?? [], active: state?.active ?? null, select, close };
}
