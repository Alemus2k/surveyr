import { describe, expect, test } from "vitest";
import { contrastRatio, ensureContrast, hexToRgb, hsvToHex, hexToHsv, parseHex, readableInk, rgbToHex } from "./colorMath";

describe("hex parsing", () => {
  test("round-trips 6-digit hex", () => {
    expect(rgbToHex(hexToRgb("#f5b400"))).toBe("#f5b400");
  });

  test("normalises user input: 3-digit, missing #, upper case", () => {
    expect(parseHex("F80")).toBe("#ff8800");
    expect(parseHex("#22D3EE")).toBe("#22d3ee");
  });

  test("rejects anything that isn't a hex colour", () => {
    expect(parseHex("orange")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });
});

describe("HSV", () => {
  test("pure hues land where the wheel puts them", () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
  });

  test("round-trips through hex", () => {
    const hsv = hexToHsv("#f5b400");
    expect(hsvToHex(hsv)).toBe("#f5b400");
  });

  test("greys have zero saturation", () => {
    expect(hexToHsv("#808080").s).toBe(0);
  });
});

describe("contrast", () => {
  test("black on white is 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  test("readable ink picks black on light colours and white on dark ones", () => {
    expect(readableInk("#f5b400")).toBe("#000000");
    expect(readableInk("#1d4ed8")).toBe("#ffffff");
  });

  test("leaves colours that already contrast enough untouched", () => {
    expect(ensureContrast("#f5b400", "#1d1f24", 3)).toBe("#f5b400");
  });

  test("darkens a pale highlight until it reads on a light panel", () => {
    const fixed = ensureContrast("#ffe680", "#f2f3f5", 3);
    expect(contrastRatio(fixed, "#f2f3f5")).toBeGreaterThanOrEqual(3);
  });

  test("lightens a dark highlight until it reads on a dark panel", () => {
    const fixed = ensureContrast("#1a1a66", "#1d1f24", 3);
    expect(contrastRatio(fixed, "#1d1f24")).toBeGreaterThanOrEqual(3);
  });
});
