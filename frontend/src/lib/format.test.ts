import { describe, expect, test } from "vitest";
import { formatArea, formatLength, formatVolume } from "./format";

describe("formatArea", () => {
  test("uses square metres for small scans", () => {
    expect(formatArea(8.415)).toEqual({ value: "8.42", unit: "m²" });
  });

  test("uses whole square metres up to a hectare", () => {
    expect(formatArea(1234.4)).toEqual({ value: "1,234", unit: "m²" });
  });

  test("switches to hectares for survey-scale sites", () => {
    expect(formatArea(40000)).toEqual({ value: "4.00", unit: "ha" });
  });
});

describe("formatVolume", () => {
  test("keeps two decimals for small volumes instead of rounding to 0", () => {
    expect(formatVolume(0.1908)).toEqual({ value: "0.19", unit: "m³" });
  });

  test("groups thousands for large volumes", () => {
    expect(formatVolume(51957.2)).toEqual({ value: "51,957", unit: "m³" });
  });
});

describe("formatLength", () => {
  test("shows centimetre precision", () => {
    expect(formatLength(0.4101)).toBe("0.41 m");
  });

  test("handles negatives", () => {
    expect(formatLength(-5.849)).toBe("−5.85 m");
  });
});
