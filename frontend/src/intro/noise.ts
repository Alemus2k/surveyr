// Small deterministic noise helpers for the intro's procedural world: the same
// world every launch, no textures to load.

/** Hash of a 2D integer cell to 0..1. */
export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise, 0..1. */
export function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise, roughly 0..1. */
export function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x, z) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Seeded 0..1 generator (Park–Miller). */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export const smooth = (e0: number, e1: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return x * x * (3 - 2 * x);
};
