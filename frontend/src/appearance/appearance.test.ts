import { describe, expect, test } from "vitest";
import { accentTokens, DEFAULT_APPEARANCE, parseAppearance, resolveTheme } from "./appearance";
import { contrastRatio } from "./colorMath";

describe("parseAppearance", () => {
  test("accepts a valid saved settings object", () => {
    const saved = { version: 1, theme: "light", accent: "#22d3ee" };
    expect(parseAppearance(saved)).toEqual(saved);
  });

  test("fills in anything missing or invalid from the defaults", () => {
    expect(parseAppearance({ version: 1, theme: "neon", accent: "blue" })).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance({ theme: "dark" })).toEqual({ ...DEFAULT_APPEARANCE, theme: "dark" });
  });
});

describe("resolveTheme", () => {
  test("system follows the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  test("explicit choices win over the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("accentTokens", () => {
  test("default amber on dark keeps the original look", () => {
    const t = accentTokens("#f5b400", "dark");
    expect(t["--accent"]).toBe("#f5b400");
    expect(t["--accent-ink"]).toBe("#000000");
  });

  test("a pale highlight is darkened enough to read in light mode", () => {
    const t = accentTokens("#fff3a0", "light");
    expect(contrastRatio(t["--accent"], "#f2f3f5")).toBeGreaterThanOrEqual(3);
  });

  test("the viewport accent is always tuned for the dark 3D background", () => {
    const t = accentTokens("#1a1a66", "light");
    expect(contrastRatio(t["--accent-viewport"], "#04060a")).toBeGreaterThanOrEqual(3);
  });

  test("provides translucent variants for fills and outlines", () => {
    const t = accentTokens("#22d3ee", "dark");
    expect(t["--accent-soft"]).toMatch(/^rgba\(\d+, \d+, \d+, 0\.14\)$/);
    expect(t["--accent-line"]).toMatch(/^rgba\(\d+, \d+, \d+, 0\.55\)$/);
  });
});
