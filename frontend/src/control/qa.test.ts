import { describe, expect, test } from "vitest";
import { cm, gradeAccuracy } from "./qa";

const stats = (mean: number, std: number, n = 12) => ({
  n,
  mean,
  std,
  rmse: Math.sqrt(mean * mean + std * std),
  max_abs: Math.abs(mean) + 2 * std,
  ci95: 1.96 * Math.sqrt(mean * mean + std * std),
});

describe("gradeAccuracy", () => {
  test("grades RMSE against the job tolerance", () => {
    expect(gradeAccuracy(stats(0, 0.008), 0.05).grade).toBe("good");
    expect(gradeAccuracy(stats(0, 0.035), 0.05).grade).toBe("fair");
    expect(gradeAccuracy(stats(0, 0.08), 0.05).grade).toBe("poor");
  });

  test("reports a consistent offset as a bias to correct", () => {
    const v = gradeAccuracy(stats(0.034, 0.007), 0.05);
    expect(v.grade).toBe("fair");
    expect(v.bias).toBeCloseTo(0.034);
  });

  test("ignores offsets that are tiny or lost in the scatter", () => {
    expect(gradeAccuracy(stats(0.004, 0.006), 0.05).bias).toBeNull(); // under 1 cm
    expect(gradeAccuracy(stats(0.015, 0.05, 4), 0.05).bias).toBeNull(); // scatter swamps it
    expect(gradeAccuracy(stats(0.03, 0.001, 2), 0.05).bias).toBeNull(); // too few points to say
  });

  test("no covered points means no verdict", () => {
    expect(gradeAccuracy({ n: 0, mean: null, std: null, rmse: null, max_abs: null, ci95: null }, 0.05)).toEqual({ grade: "none", bias: null });
  });
});

test("cm formats signed centimetres", () => {
  expect(cm(0.0343)).toBe("+3.4 cm");
  expect(cm(-0.012)).toBe("−1.2 cm");
  expect(cm(-0.012, false)).toBe("−1.2 cm");
  expect(cm(0.0002)).toBe("0.0 cm");
  expect(cm(-0.0004)).toBe("0.0 cm");
});
