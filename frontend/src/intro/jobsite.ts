// The intro's ground: an earthworks site (excavation pit, graded pad,
// stockpiles, haul road) set in rolling farmland with hedgerows and roads.
// Units are metres, y up, -z is north. surfaceHeight() is the single source of
// truth for the ground and everything standing on it, so the scan points drape
// over the machines too.
import * as THREE from "three";
import { fbm, hash2, seeded, smooth } from "./noise";

/** Half-extents of the fenced site (the area the drone scans). */
export const SITE = { halfX: 120, halfZ: 80 } as const;
/** Where the launch dock sits, just outside the west fence. */
export const DOCK_XZ = { x: -150, z: 70 } as const;
/** The site gate and the access road out to the main road. */
export const ACCESS = { x: -34, half: 3.5 } as const;
export const MAIN_ROAD = { z: 140, half: 4.5 } as const;

const WORLD_HALF = 1600;
const FINE = 1.25; // m between ground vertices around the site
const FINE_HALF = { x: 175, z: 135 }; // fine grid covers the site, dock and nearby roads
const MAX_STEP = 60; // m between vertices far out in the fields

export type PropKind = "cabin" | "cabinStack" | "loo" | "truck" | "excavator" | "dozer" | "pipes";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  w: number; // footprint along x
  d: number; // footprint along z
  h: number; // height above the ground under its centre (what the scan sees)
  facing?: number; // yaw, radians (0 = model front to +x)
}

/** Plant, cabins and materials: built by siteProps.ts, draped by the scan. */
export const STRUCTURES: readonly Prop[] = [
  { kind: "cabinStack", x: -98, z: -64, w: 12, d: 3.2, h: 5.9 },
  { kind: "cabin", x: -98, z: -58.5, w: 12, d: 3.2, h: 2.9 },
  { kind: "cabin", x: -82, z: -64, w: 7, d: 3, h: 2.8 },
  { kind: "loo", x: -72, z: -66, w: 1.3, d: 1.3, h: 2.4 },
  { kind: "loo", x: -70.2, z: -66, w: 1.3, d: 1.3, h: 2.4 },
  { kind: "loo", x: -68.4, z: -66, w: 1.3, d: 1.3, h: 2.4 },
  { kind: "pipes", x: -74, z: -42, w: 10, d: 4.2, h: 2.1 },
  { kind: "truck", x: 0, z: 12, w: 9, d: 3.2, h: 3.7 },
  { kind: "truck", x: 30, z: 12, w: 9, d: 3.2, h: 3.7, facing: Math.PI },
  { kind: "excavator", x: 4, z: -20, w: 5, d: 4.4, h: 3.6 },
  { kind: "dozer", x: -46, z: 30, w: 6, d: 3.6, h: 3.2, facing: Math.PI },
];

const PIT = { cx: 42, cz: -22, hw: 26, hd: 17, depth: 6.5, wall: 9 };
const PAD = { cx: -58, cz: 22, hw: 30, hd: 20, level: 0.6, blend: 10 };
const HAUL = { z: 12, half: 4, from: -28, to: 125 };
const PILES = [
  { x: 88, z: 38, r: 15, h: 7.5 },
  { x: 62, z: 50, r: 9, h: 4.5 },
  { x: -18, z: -56, r: 11, h: 5.5 },
];
/** Farm field grid: fields are w × d, offset so a boundary doesn't run through the site. */
export const FIELD = { w: 230, d: 170, ox: 61, oz: 23 } as const;
const SITE_SOFT = 90; // m over which the site's ground blends into the fields

/** 0 inside a rounded rectangle, rising to 1 over `soft` metres outside it. */
function outside(x: number, z: number, cx: number, cz: number, hw: number, hd: number, soft: number): number {
  const dx = Math.max(Math.abs(x - cx) - hw, 0);
  const dz = Math.max(Math.abs(z - cz) - hd, 0);
  return smooth(0, soft, Math.hypot(dx, dz));
}

function insideSite(x: number, z: number, margin = 0): boolean {
  return Math.abs(x) <= SITE.halfX + margin && Math.abs(z) <= SITE.halfZ + margin;
}

// --- height ---------------------------------------------------------------

const siteRolling = (x: number, z: number) =>
  1.3 * Math.sin(x * 0.028) + 0.9 * Math.cos(z * 0.041 + 0.6) + 0.35 * Math.sin((x + z) * 0.09);
const fieldRolling = (x: number, z: number) => (fbm(x * 0.0035, z * 0.0035, 3) - 0.5) * 30;

/** Big-scale shape: the site's gentle roll blending out into farmland hills. */
function landform(x: number, z: number): number {
  const f = outside(x, z, 0, 0, SITE.halfX + 15, SITE.halfZ + 15, SITE_SOFT);
  if (f === 0) return siteRolling(x, z);
  if (f === 1) return fieldRolling(x, z);
  return siteRolling(x, z) * (1 - f) + fieldRolling(x, z) * f;
}

/** How much (0..1) a road flattens the ground here. */
function roadMask(x: number, z: number): number {
  const main = 1 - smooth(MAIN_ROAD.half, MAIN_ROAD.half + 6, Math.abs(z - MAIN_ROAD.z));
  const access =
    z > SITE.halfZ - 4 && z < MAIN_ROAD.z ? 1 - smooth(ACCESS.half, ACCESS.half + 5, Math.abs(x - ACCESS.x)) : 0;
  return Math.max(main, access);
}

let dockLevel: number | null = null;

function terrain(x: number, z: number): number {
  const form = landform(x, z);
  let h = form;
  // fine roughness: rutted dirt in the site, tussocks in the fields
  const site = 1 - outside(x, z, 0, 0, SITE.halfX, SITE.halfZ, 20);
  h += (fbm(x * 0.35, z * 0.35, 3) - 0.5) * (0.22 * site + 0.12 * (1 - site));

  const road = roadMask(x, z);
  if (road > 0) h = h * (1 - road) + (form + 0.05) * road;
  dockLevel ??= landform(DOCK_XZ.x, DOCK_XZ.z);
  const dock = 1 - smooth(8, 14, Math.hypot(x - DOCK_XZ.x, z - DOCK_XZ.z));
  h = h * (1 - dock) + dockLevel * dock; // gravel pad under the dock

  const pad = outside(x, z, PAD.cx, PAD.cz, PAD.hw, PAD.hd, PAD.blend);
  h = h * pad + PAD.level * (1 - pad);
  if (x > HAUL.from && x < HAUL.to) {
    const haul = smooth(HAUL.half, HAUL.half + 5, Math.abs(z - HAUL.z));
    h = h * haul + 0.3 * (1 - haul);
  }
  h -= PIT.depth * (1 - outside(x, z, PIT.cx, PIT.cz, PIT.hw, PIT.hd, PIT.wall));
  for (const p of PILES) {
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist > p.r * 1.1) continue;
    const r = dist / (p.r * (0.92 + 0.16 * fbm(x * 0.15, z * 0.15, 2))); // lumpy, not a perfect cone
    if (r < 1) h += p.h * (1 - r * r) ** 1.2;
  }
  return h;
}

export const groundHeight = terrain;

/** Height of whatever the scan would hit at (x, z): ground or the top of a structure. */
export function surfaceHeight(x: number, z: number): number {
  for (const s of STRUCTURES) {
    if (Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2) return terrain(s.x, s.z) + s.h;
  }
  return terrain(x, z);
}

// --- colour ----------------------------------------------------------------

const C = {
  meadow: new THREE.Color(0x3a4a2a),
  meadowDry: new THREE.Color(0x56553a),
  crop: new THREE.Color(0x46602c),
  cropGap: new THREE.Color(0x4b3b28),
  plough: new THREE.Color(0x5a4430),
  ploughDark: new THREE.Color(0x3f3023),
  stubble: new THREE.Color(0x8a7a4e),
  hedge: new THREE.Color(0x24321d),
  verge: new THREE.Color(0x4a5634),
  dirt: new THREE.Color(0x6e5437),
  dirtDark: new THREE.Color(0x4f3c28),
  pit: new THREE.Color(0x45331f),
  pad: new THREE.Color(0x8c7a5b),
  haul: new THREE.Color(0x726a5d),
  pile: new THREE.Color(0x80603d),
  gravel: new THREE.Color(0x77736b),
  asphalt: new THREE.Color(0x2c2e31),
  paint: new THREE.Color(0xd8d2b0),
};
const tmp = new THREE.Color();

/** Farmland: patchwork fields of meadow, crop rows, ploughed earth and stubble, edged by hedges. */
function fieldColor(x: number, z: number, out: THREE.Color): THREE.Color {
  const fx = (x + FIELD.ox) / FIELD.w;
  const fz = (z + FIELD.oz) / FIELD.d;
  const cx = Math.floor(fx);
  const cz = Math.floor(fz);
  const edge = Math.min(fx - cx, 1 - (fx - cx)) * FIELD.w;
  const edgeZ = Math.min(fz - cz, 1 - (fz - cz)) * FIELD.d;
  const n = fbm(x * 0.05, z * 0.05, 3);
  if (Math.min(edge, edgeZ) < 3) return out.copy(C.hedge).multiplyScalar(0.8 + 0.4 * n);
  const kind = Math.floor(hash2(cx, cz) * 4);
  const along = hash2(cz, cx) > 0.5 ? x : z; // rows run one way or the other per field
  const rows = 0.5 + 0.5 * Math.sin(along * ((2 * Math.PI) / 2.6));
  if (kind === 0) out.copy(C.meadow).lerp(C.meadowDry, n);
  else if (kind === 1) out.copy(C.cropGap).lerp(C.crop, smooth(0.25, 0.6, rows));
  else if (kind === 2) out.copy(C.ploughDark).lerp(C.plough, rows * 0.8 + n * 0.2);
  else out.copy(C.stubble).lerp(C.meadowDry, 0.5 * rows + 0.3 * n);
  return out.multiplyScalar(0.85 + 0.3 * n);
}

function siteColor(x: number, z: number, out: THREE.Color): THREE.Color {
  const n = fbm(x * 0.12, z * 0.12, 4);
  out.copy(C.dirt).lerp(C.dirtDark, smooth(0.35, 0.75, n));
  // graded pad, with roller passes
  const pad = 1 - outside(x, z, PAD.cx, PAD.cz, PAD.hw, PAD.hd, 4);
  const roller = 0.5 + 0.5 * Math.sin((x - PAD.cx) * ((2 * Math.PI) / 4.4));
  out.lerp(tmp.copy(C.pad).multiplyScalar(0.93 + 0.07 * roller), pad);
  // haul road, with wheel ruts
  if (x > HAUL.from && x < HAUL.to) {
    const dz = Math.abs(z - HAUL.z);
    const road = 1 - smooth(HAUL.half, HAUL.half + 2, dz);
    const rut = 1 - smooth(0, 0.5, Math.min(Math.abs(dz - 0.9), Math.abs(dz - 2.6)));
    out.lerp(tmp.copy(C.haul).multiplyScalar(1 - 0.25 * rut), road);
  }
  out.lerp(C.pit, 1 - outside(x, z, PIT.cx, PIT.cz, PIT.hw, PIT.hd, PIT.wall * 0.7));
  for (const p of PILES) out.lerp(C.pile, 1 - smooth(0.6, 1, Math.hypot(x - p.x, z - p.z) / p.r));
  return out.multiplyScalar(0.82 + 0.18 * n);
}

function groundColor(x: number, z: number, out: THREE.Color): THREE.Color {
  if (insideSite(x, z)) return siteColor(x, z, out);
  fieldColor(x, z, out);
  // grass verge round the fence
  if (insideSite(x, z, 18)) out.copy(C.verge).multiplyScalar(0.85 + 0.3 * fbm(x * 0.2, z * 0.2, 2));
  const dock = 1 - smooth(9, 11, Math.hypot(x - DOCK_XZ.x, z - DOCK_XZ.z));
  out.lerp(C.gravel, dock);
  // roads: asphalt main road with a dashed centre line, gravel access road
  const mainDz = Math.abs(z - MAIN_ROAD.z);
  if (mainDz < MAIN_ROAD.half) {
    out.copy(C.asphalt).multiplyScalar(0.9 + 0.2 * fbm(x * 0.5, z * 0.5, 2));
    if (mainDz < 0.15 && ((x % 9) + 9) % 9 < 3) out.copy(C.paint);
  } else if (z > SITE.halfZ && z < MAIN_ROAD.z && Math.abs(x - ACCESS.x) < ACCESS.half) {
    out.copy(C.gravel).multiplyScalar(0.85 + 0.3 * fbm(x * 0.6, z * 0.6, 2));
  }
  return out;
}

// --- ground mesh -----------------------------------------------------------

/** Grid line positions: fine around the site, growing toward the horizon. */
function axis(fineHalf: number): number[] {
  const pos = [0];
  let x = 0;
  let step = FINE;
  while (x < WORLD_HALF) {
    if (x >= fineHalf) step = Math.min(MAX_STEP, step * 1.15);
    x += step;
    pos.push(x);
  }
  return [...pos.slice(1).reverse().map((v) => -v), ...pos];
}

function buildGround(): THREE.Mesh {
  const xs = axis(FINE_HALF.x);
  const zs = axis(FINE_HALF.z);
  const nx = xs.length;
  const nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  const colors = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = xs[i];
      const z = zs[j];
      positions[k * 3] = x;
      positions[k * 3 + 1] = terrain(x, z);
      positions[k * 3 + 2] = z;
      groundColor(x, z, c).toArray(colors, k * 3);
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      index.set([a, d, b, b, d, e], p);
      p += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }));
  mesh.receiveShadow = true;
  return mesh;
}

export { buildGround, insideSite };

/** Jittered sample of the scanned surface: what the drone's LiDAR returns. */
export function sampleSite(spacing: number, seed = 1): Float32Array {
  const rand = seeded(seed); // the same cloud every launch
  const nx = Math.floor((SITE.halfX * 2) / spacing);
  const nz = Math.floor((SITE.halfZ * 2) / spacing);
  const out = new Float32Array(nx * nz * 3);
  let i = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const x = -SITE.halfX + (a + rand()) * spacing;
      const z = -SITE.halfZ + (b + rand()) * spacing;
      out[i++] = x;
      out[i++] = surfaceHeight(x, z);
      out[i++] = z;
    }
  }
  return out;
}
