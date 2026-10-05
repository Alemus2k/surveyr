// Number formatting that adapts to scale, so a 3 m phone scan and a 200 m
// drone site both read sensibly (no "0.00 ha" or "0 m³").

export interface Quantity {
  value: string;
  unit: string;
}

const M2_PER_HA = 10_000;
const MINUS = "−";

const grouped = (v: number, digits: number): string =>
  v.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatArea(m2: number): Quantity {
  if (m2 >= M2_PER_HA) return { value: grouped(m2 / M2_PER_HA, 2), unit: "ha" };
  return { value: grouped(m2, m2 < 100 ? 2 : 0), unit: "m²" };
}

export function formatVolume(m3: number): Quantity {
  const digits = Math.abs(m3) < 10 ? 2 : Math.abs(m3) < 1000 ? 1 : 0;
  return { value: grouped(m3, digits).replace("-", MINUS), unit: "m³" };
}

export function formatLength(m: number): string {
  return `${m.toFixed(2).replace("-", MINUS)} m`;
}
