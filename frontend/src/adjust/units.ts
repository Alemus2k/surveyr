import type { Unit } from "../api";

/** Units a scan file may be in, with how many metres one of them is. */
export const UNITS: ReadonlyArray<{ id: Unit; label: string; name: string; metres: number }> = [
  { id: "m", label: "Metres", name: "metres", metres: 1 },
  { id: "cm", label: "Centimetres", name: "centimetres", metres: 0.01 },
  { id: "mm", label: "Millimetres", name: "millimetres", metres: 0.001 },
  { id: "ft", label: "Feet (international)", name: "feet", metres: 0.3048 },
  { id: "us_ft", label: "US survey feet", name: "US survey feet", metres: 1200 / 3937 },
  { id: "in", label: "Inches", name: "inches", metres: 0.0254 },
];

/** Unit name for use mid-sentence ("in US survey feet"). */
export function unitLabel(id: Unit | null | undefined): string {
  return UNITS.find((u) => u.id === id)?.name ?? "unknown units";
}
