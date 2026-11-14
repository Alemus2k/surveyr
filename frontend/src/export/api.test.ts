import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contourQuery,
  dropUnset,
  exportSite,
  exportUnitFor,
  intervalChoices,
  relativeLines,
  revealExport,
  vertexCount,
  type Contours,
} from "./api";

const sample: Contours = {
  interval: 1,
  major_every: 5,
  bounds: [612400, 4270150, 612440, 4270190],
  cell_size: 0.25,
  levels: [
    { elevation: 200, major: true, lines: [[[612400.125, 4270150.5], [612401.25, 4270151.75]]] },
    { elevation: 201, major: false, lines: [[[612410, 4270160], [612411, 4270160], [612411, 4270161], [612410, 4270160]]] },
  ],
};

describe("contourQuery", () => {
  it("only sends what is set and leaves metres implicit", () => {
    expect(contourQuery()).toBe("");
    expect(contourQuery({ interval: 0.6096, majorEvery: 5, unit: "m" })).toBe("?interval=0.6096&major_every=5");
    expect(contourQuery({ scan: "design", unit: "us_ft", smooth: 1 })).toBe("?scan=design&smooth=1&unit=us_ft");
    expect(contourQuery({ interval: null, scan: null })).toBe("");
  });
});

describe("intervalChoices", () => {
  it("offers round metres or round feet, sent in metres", () => {
    expect(intervalChoices("metric")[0]).toEqual({ label: "0.1 m", metres: 0.1 });
    const ft = intervalChoices("us");
    expect(ft.find((c) => c.label === "2 ft")!.metres).toBeCloseTo(0.6096, 10);
    expect(intervalChoices("us", true).find((c) => c.label === "1 ft")!.metres).toBeCloseTo(1200 / 3937, 12);
    expect(exportUnitFor("us")).toBe("us_ft");
    expect(exportUnitFor("metric")).toBe("m");
  });
});

describe("relativeLines", () => {
  it("keeps sub-millimetre detail at survey coordinates by subtracting the origin first", () => {
    const out = relativeLines(sample, { x: 612400, y: 4270150 });
    expect(out).toHaveLength(2);
    expect(Array.from(out[0].xy)).toEqual([0.125, 0.5, 1.25, 1.75]);
    expect(out[1].level.elevation).toBe(201);
    expect(vertexCount(sample)).toBe(6);
  });
});

describe("export requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the format and only the options that are set", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ path: "p", filename: "f", bytes: 1, files: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await exportSite("riverside commons", "csv", { unit: "us_ft", zone_id: null, spacing_m: 5 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/exports/site/riverside%20commons");
    expect(JSON.parse(init.body as string)).toEqual({ format: "csv", options: { unit: "us_ft", spacing_m: 5 } });
  });

  it("surfaces the engine's explanation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "only files in the Surveyr export folder can be shown" }), { status: 400 })));
    await expect(revealExport("C:/x")).rejects.toThrow("only files in the Surveyr export folder");
  });

  it("dropUnset keeps false and zero", () => {
    expect(dropUnset({ a: 0, b: false, c: null, d: undefined, e: "x" })).toEqual({ a: 0, b: false, e: "x" });
  });
});
