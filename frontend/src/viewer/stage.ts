// Shared 3D "stage": renderer, camera, orbit controls, backdrop, fog, compass
// heading and preset fly-tos. Single-project and comparison viewers build on it.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildBackdrop, niceStep, type SceneBox } from "./backdrop";
import { setPointsViewportHeight } from "./materials";

export type ViewPreset = "perspective" | "top" | "front";

/** What the stage frames: the scene-space box the content occupies. */
export interface StageFrame {
  box: SceneBox;
  span: number;
}

const SCENE_BG = 0x0b0b0b; // --viewport-bg
const GRID_DIVISIONS = 10; // ~grid cells across the content's long side
const CAMERA_EASE = 0.16; // fraction of remaining distance covered per frame

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Register a points material so its size attenuation follows the canvas height. */
  trackPoints: (mat: THREE.ShaderMaterial) => void;
  untrackPoints: (mat: THREE.ShaderMaterial) => void;
  /** Called every frame before rendering. */
  onFrame: (cb: () => void) => void;
  setGridVisible: (visible: boolean) => void;
  goTo: (preset: ViewPreset) => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
}

function presetPosition(preset: ViewPreset, frame: StageFrame): THREE.Vector3 {
  const s = frame.span;
  if (preset === "top") return new THREE.Vector3(0, s * 1.5, 0.001);
  if (preset === "front") return new THREE.Vector3(0, frame.box.height / 2 + s * 0.08, s * 1.35);
  return new THREE.Vector3(-s * 1.05, s * 0.75, s * 1.2);
}

export function createStage(host: HTMLElement, frame: StageFrame, onHeading: (radians: number) => void): Stage {
  const width = host.clientWidth || 800;
  const height = host.clientHeight || 500;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BG);
  scene.fog = new THREE.Fog(SCENE_BG, frame.span * 2.5, frame.span * 6);
  const backdrop = buildBackdrop(frame.box, niceStep(frame.span / GRID_DIVISIONS));
  scene.add(backdrop);

  const camera = new THREE.PerspectiveCamera(50, width / height, frame.span / 1000, frame.span * 20);
  camera.position.copy(presetPosition("perspective", frame));
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  host.prepend(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, frame.box.height / 2, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // stay above the floor grid

  const pointMats = new Set<THREE.ShaderMaterial>();
  const frameCallbacks: Array<() => void> = [];
  let flyTo: THREE.Vector3 | null = null;
  controls.addEventListener("start", () => {
    flyTo = null; // user input cancels a preset fly-to
  });

  let raf = 0;
  const animate = () => {
    if (flyTo) {
      camera.position.lerp(flyTo, CAMERA_EASE);
      if (camera.position.distanceTo(flyTo) < frame.span * 1e-3) flyTo = null;
    }
    controls.update();
    onHeading(Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z));
    for (const cb of frameCallbacks) cb();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  raf = requestAnimationFrame(animate);

  return {
    scene,
    camera,
    renderer,
    controls,
    trackPoints(mat) {
      pointMats.add(mat);
      setPointsViewportHeight(mat, renderer);
    },
    untrackPoints(mat) {
      pointMats.delete(mat);
    },
    onFrame(cb) {
      frameCallbacks.push(cb);
    },
    setGridVisible(visible) {
      backdrop.visible = visible;
    },
    goTo(preset) {
      controls.target.set(0, frame.box.height / 2, 0);
      flyTo = presetPosition(preset, frame);
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      for (const mat of pointMats) setPointsViewportHeight(mat, renderer);
    },
    dispose() {
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.domElement.remove();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
    },
  };
}
