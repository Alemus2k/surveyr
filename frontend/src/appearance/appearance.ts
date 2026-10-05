// Appearance settings: one versioned object so future options (font size,
// density, elevation colour ramp …) slot in without breaking saved settings.
import { contrastRatio, ensureContrast, hexToRgb, parseHex, readableInk, rgbToHex, withAlpha } from "./colorMath";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface Appearance {
  version: 1;
  theme: ThemeChoice;
  accent: string; // user's chosen highlight, "#rrggbb"
}

export const DEFAULT_ACCENT = "#f5b400";
export const DEFAULT_APPEARANCE: Appearance = { version: 1, theme: "dark", accent: DEFAULT_ACCENT };

export const ACCENT_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Amber", hex: "#f5b400" },
  { name: "Signal orange", hex: "#ff7a1a" },
  { name: "Coral", hex: "#ff5d73" },
  { name: "Violet", hex: "#a77bff" },
  { name: "Survey blue", hex: "#3d8bff" },
  { name: "Cyan", hex: "#22d3ee" },
  { name: "Lime", hex: "#9be32d" },
];

const THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Validate saved settings field by field; anything unusable falls back to the default. */
export function parseAppearance(raw: unknown): Appearance {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const theme = THEMES.includes(obj.theme as ThemeChoice) ? (obj.theme as ThemeChoice) : DEFAULT_APPEARANCE.theme;
  const accent = (typeof obj.accent === "string" && parseHex(obj.accent)) || DEFAULT_APPEARANCE.accent;
  return { version: 1, theme, accent };
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === "system") return systemPrefersDark ? "dark" : "light";
  return choice;
}

// Surfaces the accent must stand out against (mirror tokens.css / the 3D scene).
const PANEL_BG: Record<ResolvedTheme, string> = { dark: "#1d1f24", light: "#f2f3f5" };
const VIEWPORT_BG = "#04060a";
const MIN_UI_CONTRAST = 3; // WCAG 2.x non-text / large-text minimum
const HOVER_SHIFT = 0.12;

function shift(hex: string, towardWhite: boolean, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const target = towardWhite ? 255 : 0;
  return rgbToHex({ r: r + (target - r) * amount, g: g + (target - g) * amount, b: b + (target - b) * amount });
}

/** CSS custom properties derived from the chosen highlight for a theme. */
export function accentTokens(chosen: string, theme: ResolvedTheme): Record<string, string> {
  const accent = ensureContrast(chosen, PANEL_BG[theme], MIN_UI_CONTRAST);
  const viewport = ensureContrast(chosen, VIEWPORT_BG, MIN_UI_CONTRAST);
  const hoverTowardWhite = contrastRatio(accent, "#ffffff") > contrastRatio(accent, "#000000");
  return {
    "--accent": accent,
    "--accent-hover": shift(accent, hoverTowardWhite, HOVER_SHIFT),
    "--accent-ink": readableInk(accent),
    "--accent-soft": withAlpha(accent, 0.14),
    "--accent-line": withAlpha(accent, 0.55),
    "--accent-viewport": viewport,
    "--accent-viewport-soft": withAlpha(viewport, 0.14),
    "--accent-viewport-line": withAlpha(viewport, 0.5),
    "--accent-viewport-ink": readableInk(viewport),
  };
}
