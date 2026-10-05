import { describe, expect, test } from "vitest";
import { clampPanelWidth, PANEL_MAX, PANEL_MIN } from "./panelWidth";

describe("clampPanelWidth", () => {
  test("keeps widths inside the allowed range", () => {
    expect(clampPanelWidth(320, 1440)).toBe(320);
  });

  test("never goes narrower than the minimum", () => {
    expect(clampPanelWidth(50, 1440)).toBe(PANEL_MIN);
  });

  test("never goes wider than the maximum on large screens", () => {
    expect(clampPanelWidth(5000, 3000)).toBe(PANEL_MAX);
  });

  test("leaves at least half the window for the viewport on small screens", () => {
    expect(clampPanelWidth(500, 900)).toBe(450);
  });

  test("rounds to whole pixels", () => {
    expect(clampPanelWidth(301.6, 1440)).toBe(302);
  });
});
