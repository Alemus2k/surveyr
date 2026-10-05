import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { hsvToHex, type Hsv } from "./colorMath";

interface ColorWheelProps {
  value: Hsv;
  onChange: (hsv: Hsv) => void;
  size?: number;
}

const HUE_STEP = 3;
const SAT_STEP = 0.04;
const BIG_STEP_FACTOR = 5;
const MIN_VALUE = 0.25; // keep highlights from going near-black

/** Paint hue (angle, clockwise from east) × saturation (radius) at brightness v. */
function paintWheel(canvas: HTMLCanvasElement, size: number, v: number): void {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(size * dpr);
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(px, px);
  const r = px / 2;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const dist = Math.hypot(dx, dy);
      if (dist > r) continue;
      const h = (Math.atan2(dy, dx) * 180) / Math.PI;
      const hex = hsvToHex({ h: (h + 360) % 360, s: dist / r, v });
      const i = (y * px + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = dist > r - 1 ? Math.round(255 * (r - dist)) : 255; // soft edge
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function ColorWheel({ value, onChange, size = 184 }: ColorWheelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (canvas.current) paintWheel(canvas.current, size, value.v);
  }, [size, value.v]);

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    onChange({ ...value, h, s });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.shiftKey ? BIG_STEP_FACTOR : 1;
    const moves: Record<string, Hsv> = {
      ArrowRight: { ...value, h: (value.h + HUE_STEP * k) % 360 },
      ArrowLeft: { ...value, h: (value.h - HUE_STEP * k + 360) % 360 },
      ArrowUp: { ...value, s: Math.min(1, value.s + SAT_STEP * k) },
      ArrowDown: { ...value, s: Math.max(0, value.s - SAT_STEP * k) },
    };
    if (e.key in moves) {
      e.preventDefault();
      onChange(moves[e.key]);
    }
  };

  const rad = (value.h * Math.PI) / 180;
  const markerX = 50 + Math.cos(rad) * value.s * 50;
  const markerY = 50 + Math.sin(rad) * value.s * 50;
  const hex = hsvToHex(value);

  return (
    <div className="color-wheel-block">
      <div
        className="color-wheel"
        style={{ width: size, height: size }}
        role="slider"
        tabIndex={0}
        aria-label="Highlight hue and saturation"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(value.h) % 360}
        aria-valuetext={`hue ${Math.round(value.h) % 360}°, saturation ${Math.round(value.s * 100)}%`}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId); // keep tracking outside the wheel
          } catch {
            // capture unavailable (e.g. synthetic events): picking still works without it
          }
          dragging.current = true;
          pick(e);
        }}
        onPointerMove={(e) => dragging.current && pick(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvas} style={{ width: size, height: size }} />
        <span className="color-wheel-marker" style={{ left: `${markerX}%`, top: `${markerY}%`, background: hex }} />
      </div>
      <label className="brightness-row">
        <span className="field-label">Brightness</span>
        <input
          type="range"
          className="brightness-slider"
          min={MIN_VALUE}
          max={1}
          step={0.01}
          value={value.v}
          onChange={(e) => onChange({ ...value, v: e.target.valueAsNumber })}
          style={{ background: `linear-gradient(to right, #000, ${hsvToHex({ ...value, v: 1 })})` }}
        />
      </label>
    </div>
  );
}
