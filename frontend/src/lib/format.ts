// Number formatting that adapts to scale, so a 3 m phone scan and a 200 m
// drone site both read sensibly (no "0.00 ha" or "0 m³"). The formatters live
// in units.ts, which prints them in the user's unit system.

export { formatArea, formatLength, formatVolume, type Quantity } from "./units";
