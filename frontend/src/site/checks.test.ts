import { afterEach, describe, expect, it } from "vitest";
import { setUnitSystem } from "../lib/units";
import {
  formatStation,
  monitorFinding,
  parsePipeSize,
  pipeFallText,
  pipeLabel,
  recordCsv,
  stretchFinding,
  trenchFinding,
  verdictHeadline,
  withPipeSize,
} from "./checks";
import type { Stretch, TrenchResult } from "./checksApi";
import type { AsBuilt } from "./types";

afterEach(() => setUnitSystem("us"));

describe("formatStation", () => {
  it("writes US stations in hundreds of feet", () => {
    expect(formatStation(120 * 0.3048, 0, "us")).toBe("1+20");
    expect(formatStation(0, 0, "us")).toBe("0+00");
    expect(formatStation(5.5 * 0.3048, 0, "us")).toBe("0+06");
    expect(formatStation(1234.56 * 0.3048, 2, "us")).toBe("12+34.56");
    expect(formatStation(199.6 * 0.3048, 0, "us")).toBe("2+00"); // rounding carries into the hundreds
  });
  it("writes metric stations in kilometres + metres", () => {
    expect(formatStation(120, 0, "metric")).toBe("0+120");
    expect(formatStation(1005.25, 1, "metric")).toBe("1+005.3");
  });
});

describe("pipe sizes", () => {
  it("reads a size from a note in any common unit", () => {
    expect(parsePipeSize("450 mm storm drain to the pond")).toBeCloseTo(0.45);
    expect(parsePipeSize('18" RCP')).toBeCloseTo(0.4572);
    expect(parsePipeSize("24 in HDPE")).toBeCloseTo(0.6096);
    expect(parsePipeSize("storm drain, 2 bends")).toBeNull();
  });
  it("labels and rewrites sizes in the user's units", () => {
    expect(pipeLabel(0.4572, "us")).toBe("18 in");
    expect(pipeLabel(0.45, "metric")).toBe("450 mm");
    expect(withPipeSize("450 mm storm drain", 0.6096, "us")).toBe("24 in storm drain");
    expect(withPipeSize("storm drain", 0.3, "metric")).toBe("300 mm pipe. storm drain");
  });
});

describe("wording", () => {
  it("counts things to look at", () => {
    expect(verdictHeadline(0, 0)).toBe("Nothing to look at before the inspector does");
    expect(verdictHeadline(1, 0)).toBe("1 thing to look at before the inspector does");
    expect(verdictHeadline(2, 1)).toBe("2 things to look at before the inspector does · 1 to check with a level");
  });

  it("words OSHA prompts with the user's units", () => {
    expect(trenchFinding({ code: "spoil_setback", level: "bad", setback_m: 0.4 * 0.3048 * 1 / 0.3048 }).title).toBe("Spoil pile 1.31 ft from the edge");
    const deep = trenchFinding({ code: "protective_system", level: "bad", depth_m: 0.3048 * 8 });
    expect(deep.title).toBe("8.00 ft deep with near-vertical walls");
    expect(deep.detail).toMatch(/not|unless/); // a prompt to check, not a ruling
    setUnitSystem("metric");
    expect(trenchFinding({ code: "spoil_setback", level: "bad", setback_m: 0.4 }).title).toBe("Spoil pile 0.40 m from the edge");
  });

  it("describes a failing stretch like an inspector would", () => {
    const s = {
      length_m: 3.048 * 3, cross_pct: -3.4, cross_se_pct: 0.4, running_pct: 0.1, running_se_pct: 0.3,
      cross_status: "fail", running_status: "ok", status: "fail", middle: [1000 * 0.3048, 0],
    } as unknown as Stretch;
    const [f] = stretchFinding(s, { kind: "walk", running_limit_pct: 5, cross_limit_pct: 2 });
    expect(f.level).toBe("bad");
    expect(f.title).toBe("Cross slope 3.4 % over 30.00 ft at E 1000.0 ft, allowed 2 %");
    expect(stretchFinding({ ...s, cross_status: "ok", status: "ok" }, { kind: "walk", running_limit_pct: 5, cross_limit_pct: 2 })).toEqual([]);
  });

  it("says when a monitor is over its alert", () => {
    setUnitSystem("metric");
    const f = monitorFinding("Parking fill", { measured: true, cells: 10, settled_max_m: 0.031, heave_max_m: 0.004, alert: true, over_alert_m2: 120, cell_uncertainty_m: 0.007 }, 0.02);
    expect(f?.level).toBe("bad");
    expect(f?.title).toBe("Parking fill has settled up to 3.1 cm (±0.7 cm)");
    expect(f?.detail).toBe("More than the 2.0 cm alert over 120 m².");
    expect(monitorFinding("X", { measured: false, cells: 0 }, 0.02)).toBeNull();
  });
});

describe("as-built record", () => {
  const rec: AsBuilt = { id: "t", name: "Storm drain", kind: "trench", scan: "s", line: [[100, 200], [40, 200]], note: "450 mm, to the pond" };
  const r = {
    scan: "s", date: "2026-10-19", length_m: 60, diameter_m: 0.45, classified: true, open: true, direction: [-1, 0],
    pipe: { seen: true, slope_pct: -0.8, invert_start_m: 211.0, invert_end_m: 210.52 },
    table: [{ station: 0, e: 100, n: 200, ground: 213.5, floor: 210.9, depth: 2.6, width: 1.2, pipe_top: 211.45, invert: 211.0 }],
  } as TrenchResult;

  it("says which way the pipe falls", () => {
    expect(pipeFallText(r)).toBe("falls 0.80 % to the west");
    expect(pipeFallText({ ...r, pipe: { seen: true, slope_pct: 0.8 } })).toBe("falls 0.80 % to the east");
  });

  it("exports CSV with units in the headers", () => {
    const csv = recordCsv(rec, r, "metric").split("\n");
    expect(csv[0]).toBe("As-built record,Storm drain");
    expect(csv).toContain('Note,"450 mm, to the pond"');
    expect(csv).toContain("Pipe slope (%),0.80");
    expect(csv).toContain("Pipe falls toward,west");
    expect(csv).toContain("0.000,0+000,100.000,200.000,213.500,210.900,2.600,1.200,211.450,211.000");
    const us = recordCsv(rec, r, "us");
    expect(us).toContain("Station (ft),Station,Easting (ft)");
  });
});
