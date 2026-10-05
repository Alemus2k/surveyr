import { useCallback, useEffect, useMemo, useState } from "react";
import { loadPref, savePref } from "../lib/persist";
import { accentTokens, DEFAULT_APPEARANCE, parseAppearance, resolveTheme, type Appearance, type ResolvedTheme } from "./appearance";

const STORAGE_KEY = "surveyr.appearance";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const anyValue = (_: unknown): _ is unknown => true; // parseAppearance does the validating

export interface AppearanceApi {
  appearance: Appearance;
  theme: ResolvedTheme; // after resolving "system"
  /** Highlight tuned for the always-dark 3D viewport (for canvas/WebGL drawing). */
  viewportAccent: string;
  /** Highlight tuned for the current theme's panels. */
  uiAccent: string;
  update: (patch: Partial<Omit<Appearance, "version">>) => void;
  reset: () => void;
}

function useSystemPrefersDark(): boolean {
  const query = typeof window !== "undefined" ? window.matchMedia?.(DARK_QUERY) : undefined;
  const [dark, setDark] = useState(query?.matches ?? true);
  useEffect(() => {
    if (!query) return;
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return dark;
}

/** Appearance settings: persisted, applied to <html> as data-theme + accent tokens. */
export function useAppearance(): AppearanceApi {
  const [appearance, setAppearance] = useState<Appearance>(() => parseAppearance(loadPref(STORAGE_KEY, anyValue)));
  const systemDark = useSystemPrefersDark();
  const theme = resolveTheme(appearance.theme, systemDark);
  const tokens = useMemo(() => accentTokens(appearance.accent, theme), [appearance.accent, theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  }, [theme, tokens]);

  useEffect(() => {
    savePref(STORAGE_KEY, appearance);
  }, [appearance]);

  const update = useCallback(
    (patch: Partial<Omit<Appearance, "version">>) => setAppearance((a) => parseAppearance({ ...a, ...patch })),
    []
  );
  const reset = useCallback(() => setAppearance(DEFAULT_APPEARANCE), []);

  return {
    appearance,
    theme,
    viewportAccent: tokens["--accent-viewport"],
    uiAccent: tokens["--accent"],
    update,
    reset,
  };
}
