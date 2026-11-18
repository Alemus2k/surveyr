import { expect, test } from "vitest";
import { unpack } from "./binary";

/** Mirror of backend/app/binary.py's pack(), for tests. */
export function pack(header: object, arrays: [string, string, number[], ArrayBufferView][]): ArrayBuffer {
  const entries: object[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const [name, dtype, shape, data] of arrays) {
    const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    entries.push({ name, dtype, shape, offset, bytes: raw.length });
    const padded = new Uint8Array(raw.length + ((8 - (raw.length % 8)) % 8));
    padded.set(raw);
    chunks.push(padded);
    offset += padded.length;
  }
  let text = JSON.stringify({ ...header, arrays: entries });
  while ((4 + text.length) % 8) text += " ";
  const head = new TextEncoder().encode(text);
  const out = new Uint8Array(4 + head.length + offset);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  let at = 4 + head.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

test("unpack reads the header and views each array in place", () => {
  const buf = pack({ count: 3, note: "x" }, [
    ["rgb", "u1", [3, 3], Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ["height", "f4", [3], Float32Array.from([0.5, NaN, 2])],
    ["n", "u2", [3], Uint16Array.from([7, 0, 65535])],
  ]);
  const p = unpack<{ count: number; note: string }>(buf);
  expect(p.header.count).toBe(3);
  expect(Array.from(p.arrays.rgb)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(p.shapes.rgb).toEqual([3, 3]);
  expect(p.arrays.height[0]).toBe(0.5);
  expect(Number.isNaN(p.arrays.height[1])).toBe(true);
  expect(Array.from(p.arrays.n)).toEqual([7, 0, 65535]);
});

test("unknown array types are an error, not garbage", () => {
  expect(() => unpack(pack({}, [["x", "c16", [1], new Uint8Array(16)]]))).toThrow(/Unsupported/);
});
