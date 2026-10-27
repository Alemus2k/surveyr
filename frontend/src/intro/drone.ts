// The survey drone and its launch dock. The drone faces +z (Object3D.lookAt
// points +z at the target); its LiDAR "eye" sits under the nose.
import * as THREE from "three";

/** Drawn larger than life so it still reads from the wide shot. */
const DRONE_SCALE = 3.4;
/** Where the first-person camera sits, in drone space: up on the nose, so it sees over the dock's walls. */
export const EYE_OFFSET = new THREE.Vector3(0, 0.15, 0.6).multiplyScalar(DRONE_SCALE);

export interface Drone {
  group: THREE.Group;
  /** The glow that marks it from afar; hidden while the camera rides on board. */
  halo: THREE.Object3D;
  /** Spin the props; `dt` in seconds. */
  spin: (dt: number) => void;
  /** 0..1: fades the drone in as the camera leaves it, so it never pops into view. */
  setOpacity: (o: number) => void;
}

function haloTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const mat = (color: number, rough = 0.5, metal = 0.3) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export function buildDrone(accent: string): Drone {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(DRONE_SCALE);
  group.add(body);

  const shell = mat(0x2c2f33, 0.45, 0.4);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 1.0), shell);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  canopy.scale.set(0.9, 0.45, 1.35);
  canopy.position.y = 0.1;
  body.add(hull, canopy);

  const rotors: THREE.Object3D[] = [];
  const arm = mat(0x1d1f22, 0.6, 0.3);
  const motor = mat(0x3d4146, 0.4, 0.6);
  const disc = new THREE.MeshBasicMaterial({ color: 0xbfc5cc, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  const blade = mat(0x15171a, 0.6, 0.1);
  for (const [sx, sz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const end = new THREE.Vector3(sx * 0.78, 0.04, sz * 0.66);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, end.length()), arm);
    a.position.copy(end).multiplyScalar(0.5);
    a.lookAt(end.clone().setY(a.position.y));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 14), motor);
    m.position.copy(end);
    const rotor = new THREE.Group();
    rotor.position.copy(end).setY(0.12);
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.42, 28), disc);
    d.rotation.x = -Math.PI / 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.012, 0.05), blade);
    rotor.add(d, b);
    rotors.push(rotor);
    body.add(a, m, rotor);
  }

  // LiDAR pod and lens: the drone's "eye"
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.2, 20), mat(0x111214, 0.3, 0.5));
  pod.rotation.x = Math.PI / 2;
  pod.position.set(0, -0.14, 0.46);
  const lensMat = new THREE.MeshBasicMaterial({ color: accent });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), lensMat);
  lens.position.set(0, -0.14, 0.565);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.115, 0.14, 32), new THREE.MeshBasicMaterial({ color: 0x5a5f66 }));
  ring.position.copy(lens.position).setZ(0.566);
  body.add(pod, lens, ring);

  // nav lights: red to port, green to starboard
  const nav = (color: number, x: number) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color }));
    l.position.set(x, 0.0, -0.66);
    return l;
  };
  body.add(nav(0xff3b30, 0.78), nav(0x34c759, -0.78));

  // soft halo so the drone reads as a point of light from the wide shot
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTexture(), color: accent, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  halo.scale.setScalar(2.6);
  halo.position.set(0, -0.14, 0.4);
  body.add(halo);

  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material !== disc) o.castShadow = true;
  });

  const materials = new Map<THREE.Material, number>(); // each material and its own opacity
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) materials.set(o.material as THREE.Material, (o.material as THREE.Material).opacity);
  });
  let opacity = 1;

  return {
    group,
    halo,
    spin(dt) {
      for (const [i, r] of rotors.entries()) r.rotation.y += (i % 2 ? -1 : 1) * dt * 60;
    },
    setOpacity(o) {
      if (o === opacity) return;
      opacity = o;
      group.visible = o > 0;
      for (const [m, base] of materials) {
        m.transparent = o < 1 || m === disc;
        m.depthWrite = o === 1 && m !== disc;
        m.opacity = base * o;
        m.needsUpdate = true;
      }
    },
  };
}

export interface Dock {
  group: THREE.Group;
  /** 0 closed → 1 fully open. */
  setOpen: (f: number) => void;
}

const DOCK = { w: 9.6, h: 2.4, d: 9.6, wall: 0.2 } as const;
/** Height of the drone's origin above the dock base when it sits on the pad. */
export const DRONE_REST_Y = 1.3;

/** Drone-in-a-box launch dock with two roof lids hinged at the sides. */
export function buildDock(accent: string): Dock {
  const group = new THREE.Group();
  const shell = mat(0x3a3f45, 0.6, 0.4);
  const inner = mat(0x17191b, 0.9, 0.1);
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
    return b;
  };
  const { w, h, d, wall } = DOCK;
  add(w, wall, d, 0, wall / 2, 0, inner);
  add(wall, h, d, -w / 2, h / 2, 0, shell);
  add(wall, h, d, w / 2, h / 2, 0, shell);
  add(w, h, wall, 0, h / 2, -d / 2, shell);
  add(w, h, wall, 0, h / 2, d / 2, shell);
  // hazard stripe in the accent round the outside, so the dock reads as the app's
  const stripe = new THREE.MeshBasicMaterial({ color: accent });
  const y = h - 0.3;
  add(w + 0.04, 0.18, 0.02, 0, y, d / 2 + wall / 2 + 0.01, stripe);
  add(w + 0.04, 0.18, 0.02, 0, y, -d / 2 - wall / 2 - 0.01, stripe);
  add(0.02, 0.18, d + 0.04, w / 2 + wall / 2 + 0.01, y, 0, stripe);
  add(0.02, 0.18, d + 0.04, -w / 2 - wall / 2 - 0.01, y, 0, stripe);
  // landing pad marking
  const pad = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.85, 48), new THREE.MeshBasicMaterial({ color: accent }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = wall + 0.01;
  group.add(pad);
  const glow = new THREE.PointLight(0xe8eef5, 5, 9, 1.6);
  glow.position.set(0, h - 0.4, 0);
  group.add(glow);

  const lids = [-1, 1].map((side) => {
    const hinge = new THREE.Group();
    hinge.position.set((side * w) / 2, h, 0);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w / 2, 0.12, d), shell);
    lid.position.x = (-side * w) / 4;
    lid.castShadow = true;
    hinge.add(lid);
    group.add(hinge);
    return { hinge, side };
  });

  return {
    group,
    setOpen(f) {
      for (const { hinge, side } of lids) hinge.rotation.z = -side * f * Math.PI * 0.62; // swing up and outward
    },
  };
}
