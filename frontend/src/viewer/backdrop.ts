import * as THREE from "three";

/** Axis-aligned box the scan occupies, in scene units (Y up). */
export interface SceneBox {
  halfX: number;
  halfZ: number;
  height: number;
}

// neutral graphite, kept quiet so the scan is the brightest thing in the scene
const FLOOR_COLOR = 0x303030;
const WALL_COLOR = 0x3b3b3b;
const FLOOR_SPAN_FACTOR = 4; // floor grid runs well past the scan, toward the horizon
const AXIS_COLORS = { x: 0xd2645e, y: 0x67b884, z: 0x6890d8 } as const;

/** Round a raw grid spacing to 1, 2 or 5 x 10^n so labels stay tidy. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

/** Grid lines on a local (u, v) plane spanning [-halfU, halfU] x [0, sizeV]. */
function gridPlane(halfU: number, v0: number, v1: number, step: number, color: number): THREE.LineSegments {
  const pts: number[] = [];
  const u0 = -halfU;
  for (let u = Math.ceil(u0 / step) * step; u <= halfU + 1e-9; u += step) pts.push(u, v0, 0, u, v1, 0);
  for (let v = Math.ceil(v0 / step) * step; v <= v1 + 1e-9; v += step) pts.push(u0, v, 0, halfU, v, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
}

function axisLine(from: THREE.Vector3, to: THREE.Vector3, color: number): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
}

/**
 * Multi-axis backdrop: a wide floor grid plus two back-wall grids framing the
 * scan, with coloured X (east), Y (north) and Z (up) axis lines on the corner.
 */
export function buildBackdrop(box: SceneBox, step: number): THREE.Group {
  const group = new THREE.Group();
  const wallTop = Math.max(box.height, step) * 1.15;

  const floorHalf = Math.max(box.halfX, box.halfZ) * FLOOR_SPAN_FACTOR;
  const floor = gridPlane(floorHalf, -floorHalf, floorHalf, step, FLOOR_COLOR);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const back = gridPlane(box.halfX, 0, wallTop, step, WALL_COLOR); // XY plane, far side
  back.position.z = -box.halfZ;
  group.add(back);

  const side = gridPlane(box.halfZ, 0, wallTop, step, WALL_COLOR); // ZY plane, right side
  side.rotation.y = -Math.PI / 2;
  side.position.x = box.halfX;
  group.add(side);

  // Axes run along the wall bases; north is scene -Z (see toScene in the viewer).
  const lift = 0.001;
  const east = [new THREE.Vector3(-box.halfX, lift, -box.halfZ), new THREE.Vector3(box.halfX, lift, -box.halfZ)];
  const north = [new THREE.Vector3(box.halfX, lift, box.halfZ), new THREE.Vector3(box.halfX, lift, -box.halfZ)];
  const up = [new THREE.Vector3(box.halfX, 0, -box.halfZ), new THREE.Vector3(box.halfX, wallTop, -box.halfZ)];
  group.add(axisLine(east[0], east[1], AXIS_COLORS.x));
  group.add(axisLine(north[0], north[1], AXIS_COLORS.y));
  group.add(axisLine(up[0], up[1], AXIS_COLORS.z));
  return group;
}
