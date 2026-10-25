// Shared 3D "stage": renderer, camera, orbit controls, backdrop, fog, compass
// heading and preset fly-tos. Single-project and comparison viewers build on it.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AXIS_COLORS, axisLabelAnchors, buildBackdrop, niceStep, type AxisLabels, type SceneBox } from "./backdrop";
import { placeAxisChip, type Size } from "./axisLabelPlacement";
import { setPointsViewportHeight } from "./materials";

export type ViewPreset = "perspective" | "top" | "front";

/** What the stage frames: the scene-space box the content occupies. */
export interface StageFrame {
  box: SceneBox;
  span: number;
  axisLabels?: AxisLabels; // measurement chips at the axis ends (shown with the grid)
}

const LABEL_CAPTION: Record<keyof AxisLabels, string> = { east: "E–W", north: "N–S", up: "Highest" };
const LABEL_COLOR: Record<keyof AxisLabels, number> = { east: AXIS_COLORS.x, north: AXIS_COLORS.y, up: AXIS_COLORS.z };

/** HTML chips that follow the axis ends on screen; crisp text in the UI font at any zoom. */
function createAxisLabels(host: HTMLElement, initial: AxisLabels, anchors: Record<keyof AxisLabels, THREE.Vector3>) {
  const layer = document.createElement("div");
  layer.className = "axis-labels";
  layer.setAttribute("aria-hidden", "true"); // the same figures are in the Terrain panel
  const chips = (Object.keys(initial) as (keyof AxisLabels)[]).map((key) => {
    const chip = document.createElement("span");
    chip.className = `axis-label axis-label-${key}`;
    chip.style.setProperty("--axis-color", `#${LABEL_COLOR[key].toString(16).padStart(6, "0")}`);
    const caption = document.createElement("span");
    caption.className = "axis-label-caption";
    caption.textContent = LABEL_CAPTION[key];
    const value = document.createTextNode(initial[key]);
    chip.append(caption, value);
    layer.append(chip);
    return { key, chip, value, anchor: anchors[key], size: null as Size | null };
  });
  host.append(layer);
  // chip sizes are read from layout only when the text or font changes, never per frame
  const remeasure = () => chips.forEach((c) => (c.size = null));
  document.fonts?.ready.then(remeasure).catch(() => {});
  const p = new THREE.Vector3();
  return {
    update(camera: THREE.Camera, width: number, height: number, visible: boolean) {
      layer.hidden = !visible;
      if (!visible) return;
      for (const c of chips) {
        p.copy(c.anchor).project(camera);
        const onScreen = p.z > -1 && p.z < 1;
        c.chip.style.visibility = onScreen ? "visible" : "hidden";
        if (!onScreen) continue;
        c.size ??= { width: c.chip.offsetWidth, height: c.chip.offsetHeight };
        const anchor = { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
        // stays beside its axis end, but clamped inside the view so it's never clipped
        const at = placeAxisChip(c.key, anchor, c.size, { width, height });
        c.chip.style.transform = `translate(${at.x}px, ${at.y}px)`;
      }
    },
    setText(labels: AxisLabels) {
      for (const c of chips) c.value.data = labels[c.key];
      remeasure();
    },
    dispose: () => layer.remove(),
  };
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
  /** Update the measurement chips (no-op when the stage was built without them). */
  setAxisLabels: (labels: AxisLabels) => void;
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
  const gridStep = niceStep(frame.span / GRID_DIVISIONS);
  const backdrop = buildBackdrop(frame.box, gridStep);
  scene.add(backdrop);
  const labels = frame.axisLabels ? createAxisLabels(host, frame.axisLabels, axisLabelAnchors(frame.box, gridStep)) : null;

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

  let viewW = width, viewH = height; // kept by resize(), so frames never read layout
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
    labels?.update(camera, viewW, viewH, backdrop.visible);
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
    setAxisLabels(text) {
      labels?.setText(text);
    },
    goTo(preset) {
      controls.target.set(0, frame.box.height / 2, 0);
      flyTo = presetPosition(preset, frame);
    },
    resize(w, h) {
      viewW = w;
      viewH = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      for (const mat of pointMats) setPointsViewportHeight(mat, renderer);
    },
    dispose() {
      cancelAnimationFrame(raf);
      controls.dispose();
      labels?.dispose();
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
