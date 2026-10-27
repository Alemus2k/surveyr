// Where the particles land: points inside the letters of the wordmark, drawn
// in the same font as the DOM wordmark so the crossfade between them is exact.

const REF_PX = 200; // size the word is rasterised at for sampling
const STEP = 2; // px between candidate samples at REF_PX

export interface WordGlyphs {
  /** Inside-the-letter positions, in em, from the left end of the baseline (y down). */
  points: Float32Array; // x, y pairs
  /** Ascent and descent of the font, in em: where the baseline sits in a line box. */
  ascent: number;
  descent: number;
}

/** Sample the filled pixels of `text` set in `weight` + `family` (CSS values, as on the DOM wordmark). */
export function sampleWord(text: string, weight: string, family: string): WordGlyphs | null {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const font = `${weight} ${REF_PX}px ${family}`;
  ctx.font = font;
  const m = ctx.measureText(text);
  const ascent = m.fontBoundingBoxAscent || REF_PX * 0.9;
  const descent = m.fontBoundingBoxDescent || REF_PX * 0.25;
  const pad = 4;
  const w = Math.ceil(m.width) + pad * 2;
  const h = Math.ceil(ascent + descent) + pad * 2;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.font = font; // resizing the canvas resets its state
  ctx.fillStyle = "#fff";
  const baseline = pad + ascent;
  ctx.fillText(text, pad, baseline);

  const data = ctx.getImageData(0, 0, w, h).data;
  const out: number[] = [];
  for (let y = 0; y < h; y += STEP) {
    for (let x = 0; x < w; x += STEP) {
      if (data[(y * w + x) * 4 + 3] > 128) out.push((x - pad) / REF_PX, (y - baseline) / REF_PX);
    }
  }
  return { points: new Float32Array(out), ascent: ascent / REF_PX, descent: descent / REF_PX };
}
