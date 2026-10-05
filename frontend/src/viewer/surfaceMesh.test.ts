import { describe, expect, test } from "vitest";
import { surfaceIndices, surfacePositions } from "./surfaceMesh";

describe("surfaceIndices", () => {
  test("a fully scanned 2x2 grid becomes one quad (two triangles)", () => {
    expect(surfaceIndices([[1, 1], [1, 1]]).length).toBe(6);
  });

  test("keeps the triangle whose corners are all scanned when one corner is missing", () => {
    // row-major vertex ids: 0 1 / 2 3 ; vertex 3 unscanned
    const idx = surfaceIndices([[1, 1], [1, 0]]);
    expect(idx.length).toBe(3);
    expect([...idx].sort()).toEqual([0, 1, 2]);
  });

  test("never bridges unscanned cells", () => {
    expect(surfaceIndices([[1, 0], [0, 1]]).length).toBe(0);
    expect(surfaceIndices([[0, 0, 0], [0, 0, 0]]).length).toBe(0);
  });

  test("covers every quad of a scanned 3x3 grid", () => {
    const ones = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    expect(surfaceIndices(ones).length).toBe(4 * 6);
  });
});

describe("surfacePositions", () => {
  test("maps grid coordinates through the scene transform in row-major order", () => {
    const pos = surfacePositions([10, 11], [20], [[5, 6]], (x, y, z) => [x - 10, z, -(y - 20)]);
    expect(Array.from(pos)).toEqual([0, 5, -0, 1, 6, -0]);
  });
});
