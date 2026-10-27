import { describe, expect, test } from "vitest";
import { CHIP_EDGE_PAD, placeAxisChip, RIGHT_RESERVE } from "./axisLabelPlacement";

const VIEW = { width: 600, height: 400 };
const CHIP = { width: 100, height: 20 };

describe("placeAxisChip", () => {
  test("sits beside its axis end when there's room", () => {
    expect(placeAxisChip("east", { x: 300, y: 200 }, CHIP, VIEW)).toEqual({ x: 192, y: 190 }); // left of the end
    expect(placeAxisChip("north", { x: 300, y: 200 }, CHIP, VIEW)).toEqual({ x: 308, y: 190 }); // right of the end
    expect(placeAxisChip("up", { x: 300, y: 200 }, CHIP, VIEW)).toEqual({ x: 250, y: 174 }); // above the top
  });

  test("is pulled back inside the view, clear of the right-hand colour scale", () => {
    const p = placeAxisChip("north", { x: 760, y: 200 }, CHIP, VIEW);
    expect(p.x).toBe(VIEW.width - CHIP.width - RIGHT_RESERVE);
  });

  test("is pulled back inside the view when the axis end is off the left edge", () => {
    const p = placeAxisChip("east", { x: 20, y: 200 }, CHIP, VIEW);
    expect(p.x).toBe(CHIP_EDGE_PAD);
  });

  test("stays inside vertically too", () => {
    expect(placeAxisChip("up", { x: 300, y: 5 }, CHIP, VIEW).y).toBe(CHIP_EDGE_PAD);
    expect(placeAxisChip("east", { x: 300, y: 399 }, CHIP, VIEW).y).toBe(VIEW.height - CHIP.height - CHIP_EDGE_PAD);
  });
});
