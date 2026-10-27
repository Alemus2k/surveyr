// Where the drone and the camera are at time t. Pure: the scene samples it
// every frame, and a skip or a dropped frame never desyncs anything.
import * as THREE from "three";
import { DRONE_REST_Y } from "./drone";
import { groundHeight, SITE } from "./jobsite";
import { ease, lerp, progress, T, type Easing } from "./timeline";

const DOCK_XZ = { x: -150, z: 70 } as const;
export const DOCK_POS = new THREE.Vector3(DOCK_XZ.x, groundHeight(DOCK_XZ.x, DOCK_XZ.z), DOCK_XZ.z);
const REST = DOCK_POS.clone().setY(DOCK_POS.y + DRONE_REST_Y);
const CRUISE_Y = 50;
/** Where the first-person camera looks once it has climbed: across the site. */
export const SITE_LOOK = new THREE.Vector3(-10, 0, -8);

// Wide shot: a slow push-in from the near (south) side of the site.
const WIDE_FROM = new THREE.Vector3(-10, 92, 196);
const WIDE_TO = new THREE.Vector3(4, 84, 176);
export const WIDE_TARGET = new THREE.Vector3(0, 12, -24); // high enough to show the night sky over the town
const WIDE_SPAN = [T.pullAway[0], T.gather[1]] as const;

export function wideCamera(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.lerpVectors(WIDE_FROM, WIDE_TO, progress(t, WIDE_SPAN));
}

/** Where the drone leaves the shot after the sweep. */
export const EXIT = new THREE.Vector3(240, 150, -180);
// carry the sweep's speed into the climb, then accelerate away
const climbOut: Easing = (x) => 0.4 * x + 0.6 * x * x;

interface Key {
  t: number;
  p: THREE.Vector3;
  ease?: Easing; // for the segment ending at this key
}

const LAUNCH_DRIFT = new THREE.Vector3(6, 0, -4); // drifts toward the site as it climbs
const HOVER = REST.clone().add(LAUNCH_DRIFT).setY(CRUISE_Y - 2);

const KEYS: readonly Key[] = [
  { t: T.launch[1], p: HOVER },
  { t: 4.8, p: new THREE.Vector3(-130, CRUISE_Y, 26) },
  { t: T.scan[0], p: new THREE.Vector3(-SITE.halfX, CRUISE_Y, 0) },
  { t: (T.scan[0] + T.scan[1]) / 2, p: new THREE.Vector3(0, CRUISE_Y, 0) },
  { t: T.scan[1], p: new THREE.Vector3(SITE.halfX, CRUISE_Y, 0) },
  { t: T.exit[0] + 0.7, p: new THREE.Vector3(160, CRUISE_Y + 12, -30) },
  { t: T.exit[1], p: EXIT, ease: climbOut }, // up and away, out of shot
];
const CURVE = new THREE.CatmullRomCurve3(
  KEYS.map((k) => k.p),
  false,
  "centripetal"
);

export function dronePosition(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  if (t <= T.launch[0]) return out.copy(REST);
  if (t < T.launch[1]) {
    const climb = ease.outCubic(progress(t, T.launch));
    const drift = ease.inOutCubic(progress(t, T.launch));
    return out.copy(REST).addScaledVector(LAUNCH_DRIFT, drift).setY(lerp(REST.y, HOVER.y, climb));
  }
  const last = KEYS.length - 1;
  if (t >= KEYS[last].t) return out.copy(KEYS[last].p);
  let i = 0;
  while (KEYS[i + 1].t <= t) i++;
  const local = (KEYS[i + 1].ease ?? ease.linear)((t - KEYS[i].t) / (KEYS[i + 1].t - KEYS[i].t));
  return CURVE.getPoint((i + local) / last, out);
}

/** x of the scan line on the ground: nothing scanned before the sweep, all of it after. */
export function scanFront(t: number, droneX: number): number {
  if (t < T.scan[0]) return -Infinity;
  if (t > T.scan[1]) return Infinity;
  return droneX;
}
