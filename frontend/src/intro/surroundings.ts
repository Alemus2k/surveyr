// What lies around the site: hedgerow trees along the field boundaries, street
// lamps on the main road, and a town on the northern horizon whose windows are
// lit here and there — faint through the night haze.
import * as THREE from "three";
import { ACCESS, DOCK_XZ, FIELD, groundHeight, insideSite, MAIN_ROAD } from "./jobsite";
import { seeded } from "./noise";

const TREE_REACH = 1150; // m from the site that hedgerows are planted
const TREE_GAP = 7; // m between hedgerow trees
const LAMP_GAP = 45;
const LAMP_HEIGHT = 8;

function clearOfRoadsAndSite(x: number, z: number): boolean {
  if (insideSite(x, z, 30)) return false;
  if (Math.abs(z - MAIN_ROAD.z) < MAIN_ROAD.half + 5) return false;
  if (z > 0 && z < MAIN_ROAD.z && Math.abs(x - ACCESS.x) < ACCESS.half + 6) return false;
  return Math.hypot(x - DOCK_XZ.x, z - DOCK_XZ.z) > 25;
}

function hedgerows(): THREE.Group {
  const rand = seeded(31);
  const spots: Array<[number, number]> = [];
  const along = (fixed: number, isX: boolean) => {
    for (let s = -TREE_REACH; s < TREE_REACH; s += TREE_GAP) {
      if (rand() > 0.6) continue; // gaps in the hedge
      const jitter = (rand() - 0.5) * 4;
      const x = isX ? fixed + jitter : s + rand() * 3;
      const z = isX ? s + rand() * 3 : fixed + jitter;
      if (clearOfRoadsAndSite(x, z)) spots.push([x, z]);
    }
  };
  for (let k = Math.ceil((-TREE_REACH + FIELD.ox) / FIELD.w); k * FIELD.w - FIELD.ox < TREE_REACH; k++) along(k * FIELD.w - FIELD.ox, true);
  for (let k = Math.ceil((-TREE_REACH + FIELD.oz) / FIELD.d); k * FIELD.d - FIELD.oz < TREE_REACH; k++) along(k * FIELD.d - FIELD.oz, false);

  const canopy = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    spots.length
  );
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.18, 0.28, 1, 8).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 1 }),
    spots.length
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const y = groundHeight(x, z);
    const r = 2.4 + rand() * 2.8;
    const stem = 1.6 + rand() * 1.6;
    trunk.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, stem + r * 0.5, 1)));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    canopy.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + stem + r * 0.8, z), q, new THREE.Vector3(r, r * (0.8 + rand() * 0.45), r)));
    canopy.setColorAt(i, c.setHSL(0.22 + rand() * 0.08, 0.35 + rand() * 0.2, 0.13 + rand() * 0.08));
  });
  const g = new THREE.Group();
  g.add(trunk, canopy);
  return g;
}

function glowTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,226,170,1)");
  grad.addColorStop(0.2, "rgba(255,200,130,0.4)");
  grad.addColorStop(1, "rgba(255,180,110,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** Sodium street lamps along the main road. */
function streetLamps(): THREE.Group {
  const xs: number[] = [];
  for (let x = -1400; x <= 1400; x += LAMP_GAP) xs.push(x);
  const z = MAIN_ROAD.z - MAIN_ROAD.half - 1.2;
  const pole = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.12, LAMP_HEIGHT, 8).translate(0, LAMP_HEIGHT / 2, 0),
    new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.5 }),
    xs.length
  );
  const head = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 0.18, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc27a, emissiveIntensity: 2.5 }),
    xs.length
  );
  const glow: number[] = [];
  const m = new THREE.Matrix4();
  xs.forEach((x, i) => {
    const y = groundHeight(x, z);
    pole.setMatrixAt(i, m.makeTranslation(x, y, z));
    head.setMatrixAt(i, m.makeTranslation(x, y + LAMP_HEIGHT, z + 0.6));
    glow.push(x, y + LAMP_HEIGHT - 0.2, z + 0.6);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(glow, 3));
  const halos = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ map: glowTexture(), size: 9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })
  );
  const g = new THREE.Group();
  g.add(pole, head, halos);
  return g;
}

const buildingVertex = /* glsl */ `
  #include <fog_pars_vertex>
  attribute float aSeed;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vSeed;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vSeed = aSeed;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const buildingFragment = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec3 uBase;
  uniform vec3 uWarm;
  uniform vec3 uCool;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vSeed;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vec3 col = uBase * (0.75 + 0.5 * max(vNormalW.y, 0.0));
    if (abs(vNormalW.y) < 0.5) {
      float u = (vWorld.x + vWorld.z) / 3.2;
      float v = vWorld.y / 3.6;
      vec2 cell = fract(vec2(u, v));
      float pane = step(0.18, cell.x) * step(cell.x, 0.78) * step(0.3, cell.y) * step(cell.y, 0.82);
      float r = hash(vec3(floor(u), floor(v), vSeed));
      float lit = step(0.9, r) * pane;
      col += mix(uWarm, uCool, step(0.95, r)) * lit * (0.3 + 0.3 * fract(r * 17.0));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

/** The town: blocks of buildings on the northern horizon, taller toward its centre. */
function town(): THREE.InstancedMesh {
  const rand = seeded(47);
  const blocks: Array<{ x: number; z: number; w: number; d: number; h: number }> = [];
  const centre = { x: 260, z: -1250 };
  const add = (x: number, z: number) => {
    const core = Math.exp(-((x - centre.x) ** 2 + (z - centre.z) ** 2) / (2 * 320 ** 2));
    const h = 10 + rand() * 25 + core * (40 + rand() * 120);
    blocks.push({ x, z, w: 18 + rand() * 30, d: 18 + rand() * 30, h });
  };
  for (let x = -1500; x <= 1500; x += 42) for (let z = -1520; z <= -980; z += 46) if (rand() < 0.55) add(x + rand() * 14, z + rand() * 14);
  for (let x = 1000; x <= 1500; x += 46) for (let z = -900; z <= 60; z += 50) if (rand() < 0.45) add(x + rand() * 14, z + rand() * 14);

  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const seeds = new Float32Array(blocks.length).map(() => rand() * 100);
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uBase: { value: new THREE.Color(0x0c1018) },
        uWarm: { value: new THREE.Color(0xffc987) },
        uCool: { value: new THREE.Color(0xa9c8ff) },
      },
    ]),
    vertexShader: buildingVertex,
    fragmentShader: buildingFragment,
  });
  const mesh = new THREE.InstancedMesh(geo, material, blocks.length);
  const m = new THREE.Matrix4();
  blocks.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d).setPosition(b.x, groundHeight(b.x, b.z) - 2, b.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.frustumCulled = false;
  return mesh;
}

export function buildSurroundings(): THREE.Group {
  const g = new THREE.Group();
  g.add(hedgerows(), streetLamps(), town());
  return g;
}
