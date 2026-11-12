import { useState } from "react";
import { fromDisplay, inputStep, inputValue, useUnitSystem, type QuantityKind } from "../lib/units";

interface QuantityInputProps {
  kind: QuantityKind;
  value: number | null; // metric, as stored
  onChange: (metric: number) => void;
  min?: number; // metric limits; what's typed is clamped to them before it's stored
  max?: number;
  metricStep?: number; // arrow-key step when the user works in metric
  decimals?: number; // decimals shown (default depends on the kind)
  disabled?: boolean;
  "aria-label"?: string;
}

/**
 * Number input that shows and accepts the user's units but hands back metric.
 * What's being typed is kept as typed until the field is left, so a stored
 * value that rounds or clamps differently never rewrites the text mid-keystroke.
 */
export function QuantityInput({ kind, value, onChange, min, max, metricStep, decimals, disabled, ...rest }: QuantityInputProps) {
  useUnitSystem();
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (m: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, m));
  return (
    <input
      type="number"
      className="fig"
      step={inputStep(kind, metricStep)}
      min={min === undefined ? undefined : inputValue(min, kind, decimals)}
      max={max === undefined ? undefined : inputValue(max, kind, decimals)}
      value={draft ?? (value === null ? "" : inputValue(value, kind, decimals))}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onChange={(e) => {
        setDraft(e.target.value);
        const typed = e.target.valueAsNumber;
        if (Number.isFinite(typed)) onChange(clamp(fromDisplay(typed, kind)));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
