// Everything standing on the job site: cabins, plant, materials, the fence and
// the floodlight towers that light the site at night. Models face +x and are
// built from rounded primitives so they read as machines, not boxes.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ACCESS, groundHeight, SITE, STRUCTURES, type Prop } from "./jobsite";
import { seeded } from "./noise";

const std = (color: number, roughness = 0.6, metalness = 0.15, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

const M = {
  plant: std(0xd9a21b, 0.5, 0.25),
  plantDark: std(0xb27f12, 0.55, 0.25),
  steel: std(0x2a2c30, 0.55, 0.5),
  rubber: std(0x18191b, 0.9, 0),
  glass: std(0x0f1620, 0.15, 0.6),
  cabinWhite: std(0xcfcabf, 0.7, 0.05),
  cabinBlue: std(0x6f7c86, 0.7, 0.05),
  window: new THREE.MeshStandardMaterial({ color: 0x1b1a17, emissive: 0xffc985, emissiveIntensity: 1.6 }),
  windowDark: std(0x11161d, 0.2, 0.5),
  loo: std(0x2f6fb0, 0.6, 0.05),
  concrete: std(0x8d8a84, 0.9, 0),
  cone: std(0xe8641e, 0.6, 0),
  lamp: new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffe2b0, emissiveIntensity: 3 }),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const rbox = (w: number, h: number, d: number, r = 0.12) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

/** A beam between two points in the model's x-y plane. */
function beam(a: THREE.Vector2, b: THREE.Vector2, thick: number, width: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(rbox(len, thick, width, 0.1), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, 0);
  m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}

function wheel(x: number, z: number, r = 0.75, width = 0.55): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(r, r, width, 24), M.rubber, x, r, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

function truck(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbox(8.4, 0.5, 2.3, 0.1), M.steel, -0.2, 1.05, 0));
  g.add(mesh(rbox(2.3, 2.3, 2.6, 0.3), M.plant, 3.0, 2.35, 0)); // cab
  const screen = mesh(rbox(0.08, 1.0, 2.2, 0.03), M.glass, 4.17, 2.85, 0);
  g.add(screen);
  const bed = mesh(rbox(5.6, 1.7, 3.0, 0.15), M.plantDark, -1.3, 2.25, 0);
  bed.rotation.z = 0.04;
  g.add(bed);
  for (const x of [3.1, -0.9, -2.6]) for (const z of [-1.25, 1.25]) g.add(wheel(x, z));
  for (const z of [-0.85, 0.85]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.22, 0.4), M.lamp, 4.2, 1.6, z)); // headlights
  return g;
}

function tracks(len: number, gauge: number): THREE.Group {
  const g = new THREE.Group();
  for (const z of [-gauge / 2, gauge / 2]) {
    g.add(mesh(rbox(len, 0.95, 0.9, 0.42), M.rubber, 0, 0.48, z));
    g.add(mesh(rbox(len - 1.2, 0.3, 0.6, 0.12), M.steel, 0, 0.62, z));
  }
  return g;
}

function excavator(): THREE.Group {
  const g = tracks(4.6, 3.2);
  const upper = new THREE.Group();
  upper.position.y = 1.0;
  upper.add(mesh(rbox(3.6, 1.1, 2.9, 0.2), M.plant, -0.4, 0.75, 0)); // house
  upper.add(mesh(rbox(1.2, 1.0, 2.9, 0.3), M.steel, -2.0, 0.8, 0)); // counterweight
  upper.add(mesh(rbox(1.7, 1.9, 1.1, 0.18), M.plant, 0.7, 1.75, -0.85)); // cab
  upper.add(mesh(rbox(1.5, 1.2, 0.05, 0.02), M.glass, 0.75, 1.95, -0.29));
  const arm = new THREE.Group();
  arm.position.z = 0.55;
  const shoulder = new THREE.Vector2(1.1, 1.1);
  const elbow = new THREE.Vector2(5.6, 4.6);
  const wrist = new THREE.Vector2(8.6, 0.2);
  arm.add(beam(shoulder, elbow, 0.62, 0.55, M.plant), beam(elbow, wrist, 0.45, 0.45, M.plant));
  const bucket = mesh(rbox(1.3, 1.1, 1.5, 0.2), M.steel, 8.75, -0.25, 0);
  bucket.rotation.z = -0.5;
  arm.add(bucket);
  upper.add(arm);
  g.add(upper);
  return g;
}

function dozer(): THREE.Group {
  const g = tracks(4.0, 2.6);
  g.add(mesh(rbox(3.4, 1.4, 2.4, 0.25), M.plant, -0.2, 1.65, 0));
  g.add(mesh(rbox(1.8, 1.6, 1.9, 0.12), M.plant, -0.9, 3.0, 0));
  g.add(mesh(rbox(1.7, 1.1, 1.92, 0.05), M.glass, -0.9, 3.1, 0));
  const blade = mesh(rbox(0.35, 1.35, 3.8, 0.12), M.steel, 2.75, 0.85, 0);
  blade.rotation.z = -0.12;
  g.add(blade);
  for (const z of [-1.2, 1.2]) g.add(beam(new THREE.Vector2(0.8, 1.2), new THREE.Vector2(2.6, 0.8), 0.2, 0.2, M.plantDark).translateZ(z));
  return g;
}

function cabin(w: number, d: number, h: number, color: THREE.Material, rand: () => number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbox(w, h, d, 0.1), color, 0, h / 2, 0));
  g.add(mesh(rbox(w + 0.2, 0.15, d + 0.2, 0.05), M.steel, 0, h + 0.05, 0)); // roof lip
  const windows = Math.max(1, Math.round(w / 3.5));
  for (const side of [-1, 1]) {
    for (let i = 0; i < windows; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / windows;
      const lit = rand() > 0.35;
      g.add(mesh(new THREE.BoxGeometry(1.3, 0.85, 0.04), lit ? M.window : M.windowDark, x, h * 0.6, side * (d / 2 + 0.02)));
    }
  }
  g.add(mesh(new THREE.BoxGeometry(0.9, 2.0, 0.05), M.steel, w / 2 - 0.9, 1.05, d / 2 + 0.03)); // door
  return g;
}

function loo(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbox(1.2, 2.2, 1.2, 0.12), M.loo, 0, 1.1, 0));
  g.add(mesh(rbox(1.3, 0.14, 1.3, 0.06), M.cabinWhite, 0, 2.27, 0));
  return g;
}

function pipes(): THREE.Group {
  const g = new THREE.Group();
  const r = 0.45;
  const geo = new THREE.CylinderGeometry(r, r, 9, 24, 1, true);
  geo.rotateZ(Math.PI / 2);
  const inner = new THREE.MeshStandardMaterial({ color: 0x3c3a36, side: THREE.BackSide, roughness: 1 });
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const z = (i - (3 - row) / 2) * r * 2.02;
      const y = r + row * r * 1.75;
      g.add(mesh(geo, M.concrete, 0, y, z), mesh(geo, inner, 0, y, z));
    }
  }
  return g;
}

function buildProp(p: Prop, rand: () => number): THREE.Object3D {
  switch (p.kind) {
    case "truck":
      return truck();
    case "excavator":
      return excavator();
    case "dozer":
      return dozer();
    case "loo":
      return loo();
    case "pipes":
      return pipes();
    case "cabin":
      return cabin(p.w, p.d, p.h, rand() > 0.5 ? M.cabinWhite : M.cabinBlue, rand);
    case "cabinStack": {
      const g = cabin(p.w, p.d, p.h / 2, M.cabinWhite, rand);
      const top = cabin(p.w, p.d, p.h / 2, M.cabinBlue, rand);
      top.position.y = p.h / 2 + 0.1;
      const stair = mesh(new THREE.BoxGeometry(3.4, 0.12, 1.0), M.steel, p.w / 2 + 1.2, p.h / 4, p.d / 2 + 0.6);
      stair.rotation.z = Math.atan2(p.h / 2, 3.2);
      g.add(top, stair);
      return g;
    }
  }
}

/** Floodlight tower: trailer, mast and a bar of lamps aimed into the site. */
function lightTower(x: number, z: number): { group: THREE.Group; light: THREE.SpotLight } {
  const g = new THREE.Group();
  g.position.set(x, groundHeight(x, z), z);
  g.add(mesh(rbox(2.6, 1.0, 1.5, 0.15), M.plant, 0, 0.9, 0));
  for (const s of [-1, 1]) g.add(wheel(0, s * 0.85, 0.4, 0.25));
  const MAST = 9;
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, MAST, 12), M.steel, 0, 1.4 + MAST / 2, 0));
  const head = new THREE.Group();
  head.position.y = 1.4 + MAST;
  head.add(mesh(rbox(2.6, 0.3, 0.3, 0.05), M.steel));
  for (const lx of [-0.9, -0.3, 0.3, 0.9]) head.add(mesh(new THREE.BoxGeometry(0.5, 0.42, 0.08), M.lamp, lx, 0, 0.18));
  head.rotation.y = Math.atan2(-x, -z); // lamps (+z) face into the site
  g.add(head);

  const light = new THREE.SpotLight(0xffd6a0, 1400, 0, 1.0, 0.9, 1.6);
  light.position.set(x, g.position.y + 1.4 + MAST, z);
  light.target.position.set(x * 0.35, 0, z * 0.35);
  return { group: g, light };
}

function fence(): THREE.Group {
  const g = new THREE.Group();
  const H = 2;
  const STEP = 3;
  const corners: Array<[number, number]> = [
    [-SITE.halfX, -SITE.halfZ],
    [SITE.halfX, -SITE.halfZ],
    [SITE.halfX, SITE.halfZ],
    [-SITE.halfX, SITE.halfZ],
  ];
  const fabricPos: number[] = [];
  const rails: number[] = [];
  const posts: THREE.Vector3[] = [];
  const gate = (x: number, z: number) => z === SITE.halfZ && Math.abs(x - ACCESS.x) < ACCESS.half + 1.5;
  corners.forEach(([x0, z0], i) => {
    const [x1, z1] = corners[(i + 1) % 4];
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / STEP);
    for (let k = 0; k < n; k++) {
      const ax = x0 + ((x1 - x0) * k) / n, az = z0 + ((z1 - z0) * k) / n;
      const bx = x0 + ((x1 - x0) * (k + 1)) / n, bz = z0 + ((z1 - z0) * (k + 1)) / n;
      if (gate((ax + bx) / 2, az)) continue;
      const ay = groundHeight(ax, az), by = groundHeight(bx, bz);
      fabricPos.push(ax, ay, az, bx, by, bz, bx, by + H, bz, ax, ay, az, bx, by + H, bz, ax, ay + H, az);
      rails.push(ax, ay + H, az, bx, by + H, bz);
      posts.push(new THREE.Vector3(ax, ay + H / 2, az));
    }
  });
  const fabric = new THREE.BufferGeometry();
  fabric.setAttribute("position", new THREE.Float32BufferAttribute(fabricPos, 3));
  g.add(new THREE.Mesh(fabric, new THREE.MeshBasicMaterial({ color: 0x9da3a8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })));
  const rail = new THREE.BufferGeometry();
  rail.setAttribute("position", new THREE.Float32BufferAttribute(rails, 3));
  g.add(new THREE.LineSegments(rail, new THREE.LineBasicMaterial({ color: 0xa7abb0, transparent: true, opacity: 0.6 })));
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, H, 6), M.steel, posts.length);
  posts.forEach((p, i) => post.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  g.add(post);
  return g;
}

/** Cones lining the gate. */
function cones(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.22, 0.75, 16);
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      const x = ACCESS.x + s * (ACCESS.half + 0.6);
      const z = SITE.halfZ + 2 + i * 4 + rand();
      g.add(mesh(geo, M.cone, x, groundHeight(x, z) + 0.37, z));
    }
  }
  return g;
}

export interface SiteProps {
  group: THREE.Group;
  lights: THREE.SpotLight[];
}

const TOWERS: Array<[number, number]> = [
  [-112, -72],
  [112, -72],
  [-112, 72],
  [112, 72],
];

export function buildSiteProps(): SiteProps {
  const rand = seeded(23);
  const group = new THREE.Group();
  for (const p of STRUCTURES) {
    const o = buildProp(p, rand);
    o.position.set(p.x, groundHeight(p.x, p.z), p.z);
    o.rotation.y = p.facing ?? 0;
    group.add(o);
  }
  group.add(fence(), cones(rand));
  const lights: THREE.SpotLight[] = [];
  for (const [x, z] of TOWERS) {
    const t = lightTower(x, z);
    group.add(t.group, t.light, t.light.target);
    lights.push(t.light);
  }
  return { group, lights };
}
