// Reading the engine's packed-array responses (backend/app/binary.py):
// 4-byte little-endian header length, a JSON header, then the arrays, each
// starting on an 8-byte boundary so they can be viewed in place.

export type PackedArray = Uint8Array | Uint16Array | Uint32Array | Int16Array | Int32Array | Float32Array | Float64Array;

interface ArrayEntry {
  name: string;
  dtype: string; // numpy style: u1, u2, u4, i2, i4, f4, f8
  shape: number[];
  offset: number;
  bytes: number;
}

export interface Packed<H = Record<string, unknown>> {
  header: H;
  arrays: Record<string, PackedArray>;
  shapes: Record<string, number[]>;
}

const VIEWS: Record<string, new (buf: ArrayBuffer, offset: number, length: number) => PackedArray> = {
  u1: Uint8Array,
  u2: Uint16Array,
  u4: Uint32Array,
  i2: Int16Array,
  i4: Int32Array,
  f4: Float32Array,
  f8: Float64Array,
};

export function unpack<H = Record<string, unknown>>(buf: ArrayBuffer): Packed<H> {
  const headerLength = new DataView(buf).getUint32(0, true);
  const text = new TextDecoder().decode(new Uint8Array(buf, 4, headerLength));
  const header = JSON.parse(text) as H & { arrays: ArrayEntry[] };
  const start = 4 + headerLength;
  const arrays: Record<string, PackedArray> = {};
  const shapes: Record<string, number[]> = {};
  for (const a of header.arrays) {
    const View = VIEWS[a.dtype];
    if (!View) throw new Error(`Unsupported array type '${a.dtype}' for '${a.name}'`);
    const count = a.shape.reduce((n, d) => n * d, 1);
    arrays[a.name] = new View(buf, start + a.offset, count);
    shapes[a.name] = a.shape;
  }
  return { header, arrays, shapes };
}
