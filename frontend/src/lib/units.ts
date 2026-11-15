// Display units. The engine, every API payload and every stored value are
// metric (m, m², m³); this module is the only place that converts and formats
// for people. US customary is the default: feet to hundredths (what graders
// and surveyors read, never feet-and-inches), cubic yards, square feet / acres.
// Metric prints exactly what the app printed before units existed.

import { useSyncExternalStore } from "react";
import { loadPref, savePref } from "./persist";

export type UnitSystem = "us" | "metric";

export interface Quantity {
  value: string;
  unit: string;
}

/**
 * What a number measures, which decides its unit:
 * length = horizontal or vertical distance; elevation = height above datum;
 * small = tolerances, deviations, corrections (cm in metric); area; volume;
 * thickness = a placed layer (inches / cm, how paving and base are specified);
 * density = weight per volume (lb/ft³ / t/m³), stored in tonnes per m³.
 */
export type QuantityKind = "length" | "elevation" | "small" | "area" | "volume" | "thickness" | "density";

// Exact by definition (international foot, 1959).
export const M_PER_FT = 0.3048;
export const M2_PER_FT2 = M_PER_FT * M_PER_FT; // 0.09290304
export const M3_PER_YD3 = (3 * M_PER_FT) ** 3; // 0.764554857984
export const FT2_PER_ACRE = 43_560;
export const M_PER_IN = 0.0254;
export const T_PER_SHORT_TON = 0.90718474; // 2,000 lb
export const T_M3_PER_PCF = 0.45359237 / 1000 / M_PER_FT ** 3; // 1 lb/ft³ in t/m³ (≈ 0.016018)
const M2_PER_HA = 10_000;
const M_PER_CM = 0.01;
const MINUS = "−";

// ------------------------------------------------------------------ the active system

export const DEFAULT_UNIT_SYSTEM: UnitSystem = "us";
const STORAGE_KEY = "surveyr.units";
const isUnitSystem = (v: unknown): v is UnitSystem => v === "us" || v === "metric";

let current: UnitSystem = loadPref(STORAGE_KEY, isUnitSystem) ?? DEFAULT_UNIT_SYSTEM;
const listeners = new Set<() => void>();

export function getUnitSystem(): UnitSystem {
  return current;
}

export function setUnitSystem(next: UnitSystem): void {
  if (next === current) return;
  current = next;
  savePref(STORAGE_KEY, next);
  listeners.forEach((notify) => notify());
}

export function subscribeUnits(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The active unit system; the component re-renders when the user switches. */
export function useUnitSystem(): UnitSystem {
  return useSyncExternalStore(subscribeUnits, getUnitSystem, getUnitSystem);
}

// ------------------------------------------------------------------ conversion

/** Metric units in one display unit of ``kind``. */
function factor(kind: QuantityKind, system: UnitSystem): number {
  if (system === "metric") return kind === "small" || kind === "thickness" ? M_PER_CM : 1;
  if (kind === "thickness") return M_PER_IN;
  if (kind === "density") return T_M3_PER_PCF;
  return kind === "area" ? M2_PER_FT2 : kind === "volume" ? M3_PER_YD3 : M_PER_FT;
}

/** A metric value (m, m², m³) in the user's unit for ``kind``, unrounded. */
export function toDisplay(metric: number, kind: QuantityKind, system: UnitSystem = current): number {
  return metric / factor(kind, system);
}

/** A value typed in the user's unit for ``kind``, as metric at full precision. */
export function fromDisplay(display: number, kind: QuantityKind, system: UnitSystem = current): number {
  return display * factor(kind, system);
}

/** The unit an input of ``kind`` is typed in (areas are always typed in ft² / m²). */
export function unitOf(kind: QuantityKind, system: UnitSystem = current): string {
  if (system === "metric") return { length: "m", elevation: "m", small: "cm", area: "m²", volume: "m³", thickness: "cm", density: "t/m³" }[kind];
  return { length: "ft", elevation: "ft", small: "ft", area: "sq ft", volume: "yd³", thickness: "in", density: "lb/ft³" }[kind];
}

/** Decimals an input shows; storage keeps full precision, so this only rounds what's displayed. */
function inputDecimals(kind: QuantityKind, system: UnitSystem): number {
  if (kind === "area" || kind === "volume") return 2;
  if (kind === "thickness") return system === "metric" ? 1 : 2;
  if (kind === "density") return system === "metric" ? 2 : 1;
  return kind === "small" && system === "metric" ? 1 : 3;
}

/** The number to put in an input for a stored metric value: converted, then rounded for display. */
export function inputValue(metric: number, kind: QuantityKind, decimals?: number): number {
  return Number(toDisplay(metric, kind).toFixed(decimals ?? inputDecimals(kind, current)));
}

/**
 * Arrow-key step for an input, in the user's unit: hundredths of a foot or
 * whole cubic yards in US. Metric uses ``metricStep`` where a field had its
 * own step, else centimetres / whole units.
 */
export function inputStep(kind: QuantityKind, metricStep?: number): number {
  if (kind === "thickness") return current === "metric" ? metricStep ?? 0.5 : 0.25;
  if (kind === "density") return current === "metric" ? metricStep ?? 0.01 : 1;
  if (current === "metric") return metricStep ?? (kind === "length" || kind === "elevation" ? 0.01 : 1);
  return kind === "area" || kind === "volume" ? 1 : 0.01;
}

// ------------------------------------------------------------------ formatting

const grouped = (v: number, digits: number): string =>
  v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Up to two decimals, trailing zeros dropped: 10 → "10", 0.82021 → "0.82". */
const trimmed = (v: number): string => String(Number(v.toFixed(2)));

export const quantityText = (q: Quantity): string => `${q.value} ${q.unit}`;

interface LengthOptions {
  /** Lead with + or − (zero and above get +). */
  signed?: boolean;
  /** Decimals in metric (default 2). US is always hundredths of a foot. */
  metricDigits?: number;
}

/** A length as value + unit: "656.17" "ft" / "200.00" "m". */
export function lengthParts(m: number, { signed = false, metricDigits = 2 }: LengthOptions = {}): Quantity {
  const us = current === "us";
  const v = us ? m / M_PER_FT : m;
  const digits = us ? 2 : metricDigits;
  const value = signed ? `${v >= 0 ? "+" : MINUS}${Math.abs(v).toFixed(digits)}` : v.toFixed(digits).replace("-", MINUS);
  return { value, unit: us ? "ft" : "m" };
}

/** A distance, depth or thickness: "656.17 ft" / "200.00 m". */
export function formatLength(m: number, options?: LengthOptions): string {
  return quantityText(lengthParts(m, options));
}

/** A height above datum: "339.57 ft" / "103.50 m". */
export function formatElevation(m: number, options?: LengthOptions): string {
  return formatLength(m, options);
}

/** A difference with its sign: "+0.11 ft" / "+0.03 m". */
export function formatSigned(m: number): string {
  return formatLength(m, { signed: true });
}

/** Width × depth × height of a scan: "656.17 × 459.32 × 18.04 ft". */
export function formatDimensions(width: number, depth: number, height: number): string {
  const [w, d, h] = [width, depth, height].map((m) => lengthParts(m));
  return `${w.value} × ${d.value} × ${h.value} ${h.unit}`;
}

/**
 * An easting or northing to a tenth: "1640.4 ft" / "500.0 m". US uses the
 * international foot, so on a US-survey-foot grid it reads 2 ppm off the plans.
 */
export function formatCoordinate(m: number): string {
  const us = current === "us";
  return `${(us ? m / M_PER_FT : m).toFixed(1)} ${us ? "ft" : "m"}`;
}

/** A round-ish length given as it is, e.g. a grid cell: "0.82 ft" / "0.25 m". */
export function formatDistance(m: number): string {
  return current === "us" ? `${trimmed(m / M_PER_FT)} ft` : `${m} m`;
}

interface SmallOptions {
  /** Lead positive values with +. */
  signed?: boolean;
  /** Metric only: "fixed" = 0.1 cm (default), "trim" = drop a trailing .0, "whole" = whole cm. */
  style?: "fixed" | "trim" | "whole";
}

/**
 * A small vertical figure — tolerance, deviation, correction. Centimetres in
 * metric ("+3.4 cm"); hundredths of a foot in US ("+0.11 ft"). Zero has no sign.
 */
export function formatSmall(m: number, { signed = false, style = "fixed" }: SmallOptions = {}): string {
  const us = current === "us";
  const scaled = us ? m / M_PER_FT : m / M_PER_CM;
  const digits = us ? 2 : style === "whole" ? 0 : 1;
  const unit = us ? "ft" : "cm";
  let v = scaled.toFixed(digits);
  if (Number(v) === 0) return `${(0).toFixed(style === "fixed" || us ? digits : 0)} ${unit}`; // no "+0.0" or "−0.0"
  if (!us && style === "trim") v = String(Number(v));
  return signed && m > 0 ? `+${v} ${unit}` : `${v.replace("-", MINUS)} ${unit}`;
}

/** An area that adapts to scale: sq ft below an acre, then acres (m² below a hectare, then ha). */
export function formatArea(m2: number): Quantity {
  if (current === "us") {
    const ft2 = m2 / M2_PER_FT2;
    if (ft2 >= FT2_PER_ACRE) return { value: grouped(ft2 / FT2_PER_ACRE, 2), unit: "acres" };
    return { value: grouped(ft2, ft2 < 100 ? 2 : 0), unit: "sq ft" };
  }
  if (m2 >= M2_PER_HA) return { value: grouped(m2 / M2_PER_HA, 2), unit: "ha" };
  return { value: grouped(m2, m2 < 100 ? 2 : 0), unit: "m²" };
}

/** A volume in cubic yards (or m³): two decimals under 10, one under 1,000, then whole. */
export function formatVolume(m3: number): Quantity {
  const us = current === "us";
  const v = us ? m3 / M3_PER_YD3 : m3;
  const digits = Math.abs(v) < 10 ? 2 : Math.abs(v) < 1000 ? 1 : 0;
  return { value: grouped(v, digits).replace("-", MINUS), unit: us ? "yd³" : "m³" };
}

/**
 * A layer's thickness, the way it is specified: inches in US ("4.3 in"), centimetres
 * in metric ("10.9 cm"), one decimal.
 */
export function formatThickness(m: number, { signed = false }: { signed?: boolean } = {}): string {
  const us = current === "us";
  const v = us ? m / M_PER_IN : m / M_PER_CM;
  const text = Math.abs(v).toFixed(1);
  const sign = Number(text) === 0 ? "" : v < 0 ? MINUS : signed ? "+" : "";
  return `${sign}${text} ${us ? "in" : "cm"}`;
}

/** A weight of material: short tons in US (2,000 lb), metric tonnes otherwise. Digits like volumes. */
export function formatTonnage(tonnes: number): Quantity {
  const us = current === "us";
  const v = us ? tonnes / T_PER_SHORT_TON : tonnes;
  const digits = Math.abs(v) < 10 ? 2 : Math.abs(v) < 1000 ? 1 : 0;
  return { value: grouped(v, digits).replace("-", MINUS), unit: us ? "tons" : "t" };
}

/** A material's weight per volume: "140 lb/ft³" / "2.24 t/m³". */
export function formatDensity(tPerM3: number): string {
  return current === "us" ? `${Math.round(tPerM3 / T_M3_PER_PCF)} lb/ft³` : `${tPerM3.toFixed(2)} t/m³`;
}

/** A truck's capacity as set: "10 yd³" / "10 m³" (up to two decimals in US). */
export function formatCapacity(m3: number): string {
  return current === "us" ? `${trimmed(m3 / M3_PER_YD3)} yd³` : `${m3} m³`;
}

// ------------------------------------------------------------------ round steps

/** Round a raw spacing to 1, 2 or 5 x 10^n so labels stay tidy. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

const tidy = (v: number): number => Number(v.toPrecision(12)); // 0.30000000000000004 → 0.3

export interface LengthStep {
  metres: number; // for geometry
  label: string; // "50 ft" / "20 m"
}

/**
 * A spacing near ``rawMetres`` that is a round number *in the user's unit*
 * (50 ft, not 15.24 m): for grids, scale bars and step buttons.
 */
export function niceLengthStep(rawMetres: number): LengthStep {
  const us = current === "us";
  const step = tidy(niceStep(us ? rawMetres / M_PER_FT : rawMetres));
  return { metres: us ? step * M_PER_FT : step, label: `${step} ${us ? "ft" : "m"}` };
}

/** Round elevations in the user's unit between ``lo`` and ``hi`` (metres), about ``count`` of them. */
export function elevationTicks(lo: number, hi: number, count: number): LengthStep[] {
  const us = current === "us";
  const scale = us ? M_PER_FT : 1;
  const step = niceStep((hi - lo) / scale / count);
  const ticks: LengthStep[] = [];
  for (let v = Math.ceil(lo / scale / step) * step; v <= hi / scale + 1e-9; v += step) {
    ticks.push({ metres: v * scale, label: `${v.toFixed(2)} ${us ? "ft" : "m"}` });
  }
  return ticks;
}
