import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_UNIT_SYSTEM,
  elevationTicks,
  formatArea,
  formatCapacity,
  formatCoordinate,
  formatDimensions,
  formatDistance,
  formatElevation,
  formatLength,
  formatSigned,
  formatSmall,
  formatVolume,
  fromDisplay,
  getUnitSystem,
  inputStep,
  inputValue,
  M2_PER_FT2,
  M3_PER_YD3,
  M_PER_FT,
  niceLengthStep,
  niceStep,
  setUnitSystem,
  subscribeUnits,
  toDisplay,
  unitOf,
} from "./units";

afterEach(() => setUnitSystem(DEFAULT_UNIT_SYSTEM));

describe("unit system", () => {
  test("starts in US customary", () => {
    expect(DEFAULT_UNIT_SYSTEM).toBe("us");
    expect(getUnitSystem()).toBe("us");
  });

  test("tells subscribers when it changes, and only then", () => {
    const heard = vi.fn();
    const stop = subscribeUnits(heard);
    setUnitSystem("us"); // already US
    expect(heard).not.toHaveBeenCalled();
    setUnitSystem("metric");
    expect(getUnitSystem()).toBe("metric");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    setUnitSystem("us");
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("conversion factors", () => {
  test("are the exact international-foot definitions", () => {
    expect(M_PER_FT).toBe(0.3048);
    expect(M2_PER_FT2).toBeCloseTo(0.09290304, 12);
    expect(M3_PER_YD3).toBeCloseTo(0.764554857984, 12); // (3 × 0.3048)³
  });

  test("US: metres to feet, m² to sq ft, m³ to cubic yards", () => {
    expect(toDisplay(30.48, "length")).toBeCloseTo(100, 9);
    expect(toDisplay(30.48, "elevation")).toBeCloseTo(100, 9);
    expect(toDisplay(0.3048, "small")).toBeCloseTo(1, 12);
    expect(toDisplay(9.290304, "area")).toBeCloseTo(100, 9);
    expect(toDisplay(764.554857984, "volume")).toBeCloseTo(1000, 9);
    expect(fromDisplay(100, "length")).toBeCloseTo(30.48, 12);
    expect(fromDisplay(27, "volume")).toBeCloseTo(20.642981165568, 9); // 27 yd³ = a 9 ft cube
  });

  test("metric: only small figures change unit (cm)", () => {
    setUnitSystem("metric");
    expect(toDisplay(12.5, "length")).toBe(12.5);
    expect(toDisplay(12.5, "volume")).toBe(12.5);
    expect(toDisplay(0.05, "small")).toBeCloseTo(5, 12);
    expect(fromDisplay(2.5, "small")).toBeCloseTo(0.025, 12);
  });

  test("input units", () => {
    expect(["length", "elevation", "small", "area", "volume"].map((k) => unitOf(k as "length"))).toEqual(["ft", "ft", "ft", "sq ft", "yd³"]);
    setUnitSystem("metric");
    expect(["length", "elevation", "small", "area", "volume"].map((k) => unitOf(k as "length"))).toEqual(["m", "m", "cm", "m²", "m³"]);
  });
});

describe("inputs", () => {
  test("what's typed comes back exactly: stored metric at full precision, rounded only to show", () => {
    for (const system of ["us", "metric"] as const) {
      setUnitSystem(system);
      for (const typed of [0.16, 0.05, 1.5, 12, 332.19, 4321.07, -0.66]) {
        for (const kind of ["length", "elevation", "small", "volume"] as const) {
          const stored = fromDisplay(typed, kind);
          expect(inputValue(stored, kind, 3)).toBe(typed);
          expect(inputValue(fromDisplay(inputValue(stored, kind, 3), kind), kind, 3)).toBe(typed); // re-open, re-save: no drift
        }
      }
    }
  });

  test("a stored metric value shows rounded in the user's unit", () => {
    expect(inputValue(0.05, "small")).toBe(0.164); // 5 cm tolerance = 0.164 ft
    expect(inputValue(101.25, "elevation")).toBe(332.185);
    expect(inputValue(10, "volume")).toBe(13.08);
    setUnitSystem("metric");
    expect(inputValue(0.05, "small")).toBe(5);
    expect(inputValue(0.0343, "small")).toBe(3.4);
    expect(inputValue(101.2504, "elevation")).toBe(101.25);
  });

  test("steps: hundredths of a foot and whole yards in US; the field's own step in metric", () => {
    expect(inputStep("small", 0.5)).toBe(0.01);
    expect(inputStep("elevation", 0.001)).toBe(0.01);
    expect(inputStep("volume", 1)).toBe(1);
    setUnitSystem("metric");
    expect(inputStep("small", 0.5)).toBe(0.5);
    expect(inputStep("elevation", 0.001)).toBe(0.001);
    expect(inputStep("length")).toBe(0.01);
    expect(inputStep("volume")).toBe(1);
  });
});

describe("US formatting", () => {
  test("lengths and elevations are feet to hundredths, never feet-and-inches", () => {
    expect(formatLength(200)).toBe("656.17 ft"); // 200 / 0.3048 = 656.168
    expect(formatLength(0.3048)).toBe("1.00 ft");
    expect(formatElevation(103.5)).toBe("339.57 ft");
    expect(formatLength(-5.849)).toBe("−19.19 ft");
  });

  test("differences carry their sign", () => {
    expect(formatSigned(0.0343)).toBe("+0.11 ft");
    expect(formatSigned(-0.2)).toBe("−0.66 ft");
    expect(formatSigned(0)).toBe("+0.00 ft");
  });

  test("small figures are also feet", () => {
    expect(formatSmall(0.05)).toBe("0.16 ft"); // 5 cm
    expect(formatSmall(0.0343, { signed: true })).toBe("+0.11 ft");
    expect(formatSmall(-0.012, { signed: true })).toBe("−0.04 ft");
    expect(formatSmall(0.0005, { signed: true })).toBe("0.00 ft");
    expect(formatSmall(0.05, { style: "whole" })).toBe("0.16 ft"); // styles only matter in metric
  });

  test("areas are square feet below an acre, then acres", () => {
    expect(formatArea(8.415)).toEqual({ value: "90.58", unit: "sq ft" }); // 8.415 / 0.09290304
    expect(formatArea(1000)).toEqual({ value: "10,764", unit: "sq ft" });
    expect(formatArea(4046.8564224)).toEqual({ value: "1.00", unit: "acres" });
    expect(formatArea(40000)).toEqual({ value: "9.88", unit: "acres" }); // 4 ha
  });

  test("volumes are cubic yards", () => {
    expect(formatVolume(0.764554857984)).toEqual({ value: "1.00", unit: "yd³" });
    expect(formatVolume(100)).toEqual({ value: "130.8", unit: "yd³" }); // 100 / 0.7645549
    expect(formatVolume(51957.2)).toEqual({ value: "67,957", unit: "yd³" });
    expect(formatVolume(-10)).toEqual({ value: "−13.1", unit: "yd³" });
  });

  test("truck sizes, cell sizes, coordinates and scan sizes", () => {
    expect(formatCapacity(7.64554857984)).toBe("10 yd³");
    expect(formatCapacity(10)).toBe("13.08 yd³");
    expect(formatDistance(0.25)).toBe("0.82 ft");
    expect(formatDistance(0.3048)).toBe("1 ft");
    expect(formatCoordinate(500)).toBe("1640.4 ft");
    expect(formatDimensions(200, 140, 5.5)).toBe("656.17 × 459.32 × 18.04 ft");
  });
});

describe("metric formatting is what the app printed before units", () => {
  test("lengths, differences and small figures", () => {
    setUnitSystem("metric");
    expect(formatLength(0.4101)).toBe("0.41 m");
    expect(formatLength(-5.849)).toBe("−5.85 m");
    expect(formatLength(101.25, { metricDigits: 3 })).toBe("101.250 m");
    expect(formatSigned(-0.2)).toBe("−0.20 m");
    expect(formatSmall(0.0343, { signed: true })).toBe("+3.4 cm");
    expect(formatSmall(0.05, { style: "trim" })).toBe("5 cm");
    expect(formatSmall(0.025, { style: "trim" })).toBe("2.5 cm");
    expect(formatSmall(0.05, { style: "whole" })).toBe("5 cm");
    expect(formatSmall(0.0002)).toBe("0.0 cm");
  });

  test("areas, volumes and the rest", () => {
    setUnitSystem("metric");
    expect(formatArea(1234.4)).toEqual({ value: "1,234", unit: "m²" });
    expect(formatArea(40000)).toEqual({ value: "4.00", unit: "ha" });
    expect(formatVolume(51957.2)).toEqual({ value: "51,957", unit: "m³" });
    expect(formatCapacity(10)).toBe("10 m³");
    expect(formatDistance(0.25)).toBe("0.25 m");
    expect(formatCoordinate(500)).toBe("500.0 m");
    expect(formatDimensions(200, 140, 5.5)).toBe("200.00 × 140.00 × 5.50 m");
  });
});

describe("round steps", () => {
  test("niceStep rounds to 1, 2 or 5 × 10ⁿ", () => {
    expect([0.013, 0.3, 4, 7.4, 8, 14.9, 160].map(niceStep).map((v) => Number(v.toPrecision(6)))).toEqual([0.01, 0.2, 5, 5, 10, 10, 200]);
    expect(niceStep(0)).toBe(1);
  });

  test("US steps are round numbers of feet, not converted round metres", () => {
    const step = niceLengthStep(15); // 15 m = 49.2 ft → 50 ft
    expect(step.label).toBe("50 ft");
    expect(step.metres).toBeCloseTo(15.24, 9);
    expect(niceLengthStep(0.1).label).toBe("0.2 ft"); // 0.328 ft; no "0.30000000000000004"
    expect(niceLengthStep(100).label).toBe("200 ft"); // 328 ft
  });

  test("metric steps are unchanged", () => {
    setUnitSystem("metric");
    expect(niceLengthStep(15)).toEqual({ metres: 20, label: "20 m" });
    expect(niceLengthStep(42)).toEqual({ metres: 50, label: "50 m" });
  });

  test("elevation ticks land on round feet", () => {
    const ticks = elevationTicks(98, 103.5, 3); // 321.5 to 339.6 ft, 18 ft range → every 5 ft
    expect(ticks.map((t) => t.label)).toEqual(["325.00 ft", "330.00 ft", "335.00 ft"]);
    expect(ticks[0].metres).toBeCloseTo(99.06, 9); // 325 × 0.3048
  });

  test("elevation ticks land on round metres in metric", () => {
    setUnitSystem("metric");
    expect(elevationTicks(98, 103.5, 3).map((t) => t.label)).toEqual(["98.00 m", "100.00 m", "102.00 m"]);
  });
});
