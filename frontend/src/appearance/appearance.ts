// Appearance settings: one versioned object so future options (font size,
// density, elevation colour ramp …) slot in without breaking saved settings.
import { contrastRatio, ensureContrast, hexToRgb, parseHex, readableInk, rgbToHex, withAlpha } from "./colorMath";

export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export interface Appearance {
  version: 1;
  theme: ThemeChoice;
  accent: string; // user's chosen highlight, "#rrggbb"
  intro: boolean; // play the launch animation when the app opens
}

export const DEFAULT_ACCENT = "#eeb02b";
const LEGACY_DEFAULT_ACCENT = "#f5b400"; // the old default amber: saved settings move to the refined one
export const DEFAULT_APPEARANCE: Appearance = { version: 1, theme: "dark", accent: DEFAULT_ACCENT, intro: true };

export const ACCENT_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Amber", hex: "#eeb02b" },
  { name: "Signal orange", hex: "#f0832e" },
  { name: "Coral", hex: "#ec6a78" },
  { name: "Violet", hex: "#9d86f2" },
  { name: "Survey blue", hex: "#4f8fea" },
  { name: "Cyan", hex: "#3fc1d3" },
  { name: "Lime", hex: "#93c84a" },
];

const THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** Validate saved settings field by field; anything unusable falls back to the default. */
export function parseAppearance(raw: unknown): Appearance {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const theme = THEMES.includes(obj.theme as ThemeChoice) ? (obj.theme as ThemeChoice) : DEFAULT_APPEARANCE.theme;
  const parsed = (typeof obj.accent === "string" && parseHex(obj.accent)) || DEFAULT_APPEARANCE.accent;
  const accent = parsed === LEGACY_DEFAULT_ACCENT ? DEFAULT_ACCENT : parsed;
  const intro = typeof obj.intro === "boolean" ? obj.intro : DEFAULT_APPEARANCE.intro;
  return { version: 1, theme, accent, intro };
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === "system") return systemPrefersDark ? "dark" : "light";
  return choice;
}

// Surfaces the accent must stand out against (mirror tokens.css / the 3D scene).
const PANEL_BG: Record<ResolvedTheme, string> = { dark: "#1a1a1a", light: "#ffffff" };
const VIEWPORT_BG = "#0b0b0b";
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
