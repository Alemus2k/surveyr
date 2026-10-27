// The intro's 3D shot: night over the job site and the farmland round it,
// the dock, the drone and its scan. render(t) poses everything from the timeline and draws one frame.
import * as THREE from "three";
import { buildDock, buildDrone, EYE_OFFSET } from "./drone";
import { DOCK_POS, dronePosition, scanFront, SITE_LOOK, WIDE_TARGET, wideCamera } from "./flightPath";
import { buildGround } from "./jobsite";
import { buildScanEffect, type WordAnchor } from "./scanEffect";
import { buildSiteProps } from "./siteProps";
import { buildNightSky, HORIZON, SKY_RADIUS } from "./sky";
import { buildSurroundings } from "./surroundings";
import { ease, progress, T } from "./timeline";

const FOV = 50;
const HALO_BEYOND = 25; // m from the camera before the drone's glow is drawn (not on board)
const LIFT_OFF = 16; // m the camera rises straight up off the drone before arcing back
const CHASE_BACK = 30; // m behind the drone the pull-away arcs through
const CHASE_UP = 16;
const CHASE_LEAD = 12; // m ahead of the drone the chase shot aims, so it sits just below centre
const DRONE_FADE: readonly [number, number] = [5, 14]; // m from the camera: drone fades in across this
const HEADING_LOOKAHEAD = 0.06; // s
const MAX_PITCH = 0.32; // rad nose-down at full cruise speed
const PITCH_PER_MPS = 0.006;

export interface IntroScene {
  /** Pose everything for time t (seconds) and draw. */
  render: (t: number) => void;
  /** Letter shapes the points land on, and where the DOM wordmark is on screen. */
  setWord: (glyphs: Float32Array | null, anchor: WordAnchor) => void;
  /** Altitude of the drone above the dock, for the HUD. */
  altitude: (t: number) => number;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

/** Full-screen black, drawn over the site (not the points) to fade the world out. */
function buildFade(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: "void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }",
    fragmentShader: "uniform float uOpacity; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity); }",
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  quad.frustumCulled = false;
  quad.renderOrder = 5;
  return quad;
}

/** Cubic Bézier from a to d via controls b and c, at u (0..1). */
function bezier3(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u: number, out: THREE.Vector3) {
  const v = 1 - u;
  const [ka, kb, kc, kd] = [v * v * v, 3 * u * v * v, 3 * u * u * v, u * u * u];
  return out.set(
    ka * a.x + kb * b.x + kc * c.x + kd * d.x,
    ka * a.y + kb * b.y + kc * c.y + kd * d.y,
    ka * a.z + kb * b.z + kc * c.z + kd * d.z
  );
}

export function createIntroScene(host: HTMLElement, accent: string): IntroScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 380, 2000); // the town stays faint, the site stays crisp
  const sky = buildNightSky();
  scene.add(sky.group, ...sky.lights);
  scene.add(buildGround(), buildSurroundings());
  const props = buildSiteProps();
  scene.add(props.group);

  const toSite = new THREE.Vector3().subVectors(SITE_LOOK, DOCK_POS).setY(0).normalize();
  const dock = buildDock(accent);
  dock.group.position.copy(DOCK_POS);
  dock.group.rotation.y = Math.atan2(toSite.x, toSite.z); // lids open to the sides of the drone's view
  scene.add(dock.group);
  const drone = buildDrone(accent);
  scene.add(drone.group);
  const scan = buildScanEffect(accent);
  scene.add(scan.group);
  const fade = buildFade();
  scene.add(fade);

  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, SKY_RADIUS * 1.2);

  const pos = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const wide = new THREE.Vector3();
  const lookUp = new THREE.Vector3();
  const pod = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const chase = new THREE.Vector3();
  const chaseLook = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const dirFP = new THREE.Vector3();
  const dirChase = new THREE.Vector3();
  const dirWide = new THREE.Vector3();
  let lastT = 0;

  const poseDrone = (t: number) => {
    dronePosition(t, pos);
    dronePosition(t + HEADING_LOOKAHEAD, ahead);
    vel.subVectors(ahead, pos).divideScalar(HEADING_LOOKAHEAD);
    drone.group.position.copy(pos);
    const flat = vel.clone().setY(0);
    // on the pad and climbing straight up there's no heading: face the site
    const heading = flat.lengthSq() > 4 ? flat.normalize() : toSite;
    facing.copy(heading);
    drone.group.lookAt(ahead.copy(pos).add(heading));
    drone.group.rotateX(Math.min(MAX_PITCH, flat.length() * PITCH_PER_MPS));
    drone.group.updateMatrixWorld();
  };

  const poseCamera = (t: number) => {
    // first person: from the lens, looking up through the opening lids, then down over the site
    eye.copy(EYE_OFFSET).applyMatrix4(drone.group.matrixWorld);
    lookUp.copy(eye).addScaledVector(toSite, 10).add(new THREE.Vector3(0, 2.2, 0)); // just above the horizon
    const tilt = ease.inOutCubic(progress(t, [T.launch[0] + 0.2, T.launch[0] + 1.6]));
    look.lerpVectors(lookUp, SITE_LOOK, tilt);
    // third person: rise straight up off the drone (clear of its rotors), arc back
    // chase-cam style, then out to the wide shot along a cubic Bézier.
    const u = ease.smoother(progress(t, T.pullAway));
    if (u === 0) {
      camera.position.copy(eye);
      camera.lookAt(look);
      return;
    }
    wideCamera(t, wide);
    lift.copy(eye).add(new THREE.Vector3(0, LIFT_OFF, 0));
    chase.copy(pos).addScaledVector(facing, -CHASE_BACK).add(new THREE.Vector3(0, CHASE_UP, 0));
    bezier3(eye, lift, chase, wide, u, camera.position);
    // aim: blend directions (not points), from the first-person view onto the drone, then out to the site
    const cam = camera.position;
    const toLook = dirFP.subVectors(look, cam).normalize();
    const toDrone = dirChase.copy(pos).addScaledVector(facing, CHASE_LEAD).sub(cam).normalize();
    const toWide = dirWide.subVectors(WIDE_TARGET, cam).normalize();
    const onDrone = ease.smoother(Math.min(1, u * 2.6));
    const outWide = ease.smoother(Math.max(0, u * 2 - 1));
    toLook.lerp(toDrone, onDrone).normalize().lerp(toWide, outWide).normalize();
    camera.lookAt(chaseLook.copy(cam).add(toLook));
  };

  return {
    render(t) {
      const dt = Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      dock.setOpen(ease.inOutCubic(progress(t, T.lidsOpen)));
      poseDrone(t);
      drone.spin(dt);
      poseCamera(t);
      const away = camera.position.distanceTo(drone.group.position);
      drone.setOpacity(t < T.exit[1] ? progress(away, DRONE_FADE) : 0);
      drone.halo.visible = camera.position.distanceTo(drone.group.position) > HALO_BEYOND;

      const fan = progress(t, [T.scan[0] - 0.2, T.scan[0] + 0.2]) * (1 - progress(t, [T.scan[1] - 0.15, T.scan[1] + 0.15]));
      pod.set(0, -0.35, 0.4).applyMatrix4(drone.group.matrixWorld);
      scan.update(scanFront(t, pos.x), pod, fan);
      scan.gather(progress(t, T.gather), progress(t, T.wordIn));
      (fade.material as THREE.ShaderMaterial).uniforms.uOpacity.value = ease.inOutCubic(progress(t, T.worldOut));
      sky.update(t, renderer.getPixelRatio());
      renderer.render(scene, camera);
    },
    setWord: scan.setWord,
    altitude(t) {
      return dronePosition(t, pos).y - DOCK_POS.y;
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      const dpr = renderer.getPixelRatio();
      scan.setScale((h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))), dpr);
    },
    dispose() {
      renderer.domElement.remove();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
    },
  };
}
