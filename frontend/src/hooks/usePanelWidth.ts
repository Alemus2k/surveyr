import { useCallback, useEffect, useState } from "react";
import { clampPanelWidth, PANEL_DEFAULT } from "../lib/panelWidth";
import { loadPref, savePref } from "../lib/persist";

const STORAGE_KEY = "surveyr.panelWidth";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Side panel width, clamped to the window and remembered between launches. */
export function usePanelWidth(): [number, (w: number) => void, () => void] {
  const [width, setWidthRaw] = useState(() =>
    clampPanelWidth(loadPref(STORAGE_KEY, isNumber) ?? PANEL_DEFAULT, window.innerWidth)
  );

  const setWidth = useCallback((w: number) => setWidthRaw(clampPanelWidth(w, window.innerWidth)), []);
  const reset = useCallback(() => setWidthRaw(clampPanelWidth(PANEL_DEFAULT, window.innerWidth)), []);

  useEffect(() => {
    savePref(STORAGE_KEY, width);
  }, [width]);

  useEffect(() => {
    const onResize = () => setWidthRaw((w) => clampPanelWidth(w, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return [width, setWidth, reset];
}
