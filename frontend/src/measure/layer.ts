// The measurement overlay inside a 3D stage: picking with the ground index,
// lines / markers / fills drawn over the points, and HTML labels that follow
// them on screen. Knows nothing about React or units; it is handed text.
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { Stage } from "../viewer/stage";
import { cloudToScene, type PreparedCloud } from "../viewer/prepare";
import { sceneToSurvey, type Vec3 } from "./geometry";
import { buildGroundIndex, type GroundIndex } from "./groundIndex";

/** One thing to draw: a marker, a polyline or a polygon, with an optional label. */
export interface OverlayShape {
  key: string;
  points: Vec3[]; // survey coordinates
  closed: boolean;
  fill: boolean;
  tag: string | null; // "D2"
  label: string | null; // "144.36 ft · 2.0 %"
  labelAt: Vec3 | null;
  emphasis: boolean; // selected or being drawn
}

export interface MeasureLayer {
  canvas: HTMLCanvasElement;
  /** Mean plan spacing of the points, metres. */
  spacing: number;
  /** The ground spot under the cursor (survey coordinates), or null off the scan. */
  pick: (clientX: number, clientY: number) => Vec3 | null;
  /** Ground elevation at a survey plan position (median of the nearest points), or null. */
  groundAt: (e: number, n: number) => number | null;
  /** Where a survey point is on screen (client pixels), or null when behind the camera. */
  project: (p: Vec3) => { x: number; y: number } | null;
  setShapes: (shapes: OverlayShape[]) => void;
  setDraft: (shape: OverlayShape | null) => void;
  setHover: (p: Vec3 | null) => void;
  setAccent: (hex: string) => void;
  setCursor: (cursor: string) => void;
  dispose: () => void;
}

const PICK_PX = 7; // pick radius around the cursor
const LINE_PX = 2.5;
const HALO_PX = 6;
const DOT_PX = 9;
const RING_PX = 22;
const NORMAL = 0xf2f2f2;
const OVERLAY_ORDER = 10; // drawn after (over) the points and outlines

function discTexture(ring: boolean): THREE.Texture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  if (g) {
    g.lineWidth = ring ? 6 : 8;
    g.beginPath();
    g.arc(s / 2, s / 2, ring ? s / 2 - 8 : s / 2 - 6, 0, Math.PI * 2);
    if (ring) {
      g.strokeStyle = "rgba(0,0,0,0.65)";
      g.lineWidth = 12;
      g.stroke();
      g.strokeStyle = "#ffffff";
      g.lineWidth = 5;
      g.stroke();
      g.beginPath();
      g.arc(s / 2, s / 2, 3.5, 0, Math.PI * 2);
      g.fillStyle = "#ffffff";
      g.fill();
    } else {
      g.fillStyle = "#ffffff";
      g.strokeStyle = "rgba(0,0,0,0.75)";
      g.fill();
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMeasureLayer(stage: Stage, cloud: PreparedCloud, host: HTMLElement, accent: string): MeasureLayer {
  const index: GroundIndex = buildGroundIndex(cloud);
  const toScene = cloudToScene(cloud);
  const sv = (p: Vec3) => new THREE.Vector3(...toScene(p[0], p[1], p[2]));
  const canvas = stage.renderer.domElement;

  const root = new THREE.Group();
  root.renderOrder = OVERLAY_ORDER;
  stage.scene.add(root);
  const shapesGroup = new THREE.Group();
  const draftGroup = new THREE.Group();
  root.add(shapesGroup, draftGroup);

  const accentColor = new THREE.Color(accent);
  const lineMat = (px: number, color: THREE.Color | number, opacity = 1) =>
    new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: px, transparent: true, opacity, depthTest: false, depthWrite: false });
  const mats = {
    halo: lineMat(HALO_PX, 0x000000, 0.55),
    line: lineMat(LINE_PX, NORMAL),
    lineEm: lineMat(LINE_PX, accentColor),
    fill: new THREE.MeshBasicMaterial({ color: NORMAL, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    fillEm: new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
    dot: new THREE.SpriteMaterial({ map: discTexture(false), color: NORMAL, sizeAttenuation: false, depthTest: false, depthWrite: false }),
    dotEm: new THREE.SpriteMaterial({ map: discTexture(false), color: accentColor, sizeAttenuation: false, depthTest: false, depthWrite: false }),
    ring: new THREE.SpriteMaterial({ map: discTexture(true), color: accentColor, sizeAttenuation: false, depthTest: false, depthWrite: false }),
  };
  const lineMats = [mats.halo, mats.line, mats.lineEm];

  const hover = new THREE.Sprite(mats.ring);
  hover.renderOrder = OVERLAY_ORDER + 3;
  hover.visible = false;
  root.add(hover);

  // ---- HTML labels
  const labelLayer = document.createElement("div");
  labelLayer.className = "measure-labels";
  labelLayer.setAttribute("aria-hidden", "true"); // the same figures are in the measurements panel
  host.append(labelLayer);
  type Label = { el: HTMLElement; at: THREE.Vector3 };
  let labels: Label[] = [];
  let draftLabels: Label[] = [];

  function makeLabel(s: OverlayShape): Label | null {
    if (!s.label || !s.labelAt) return null;
    const el = document.createElement("span");
    el.className = `measure-label${s.emphasis ? " is-emphasis" : ""}`;
    if (s.tag) {
      const tag = document.createElement("span");
      tag.className = "measure-label-tag";
      tag.textContent = s.tag;
      el.append(tag);
    }
    el.append(document.createTextNode(s.label));
    labelLayer.append(el);
    return { el, at: sv(s.labelAt) };
  }

  const dotScale = { v: 0, ring: 0 };
  const sprites: THREE.Sprite[] = [];

  function build(group: THREE.Group, s: OverlayShape) {
    const pts = s.points.map(sv);
    if (pts.length >= 3 && s.fill) {
      const contour = s.points.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      geo.setIndex(tris.flat());
      const mesh = new THREE.Mesh(geo, s.emphasis ? mats.fillEm : mats.fill);
      mesh.renderOrder = OVERLAY_ORDER;
      group.add(mesh);
    }
    if (pts.length >= 2) {
      const ring = s.closed && pts.length >= 3 ? [...pts, pts[0]] : pts;
      const geo = new LineGeometry();
      geo.setPositions(ring.flatMap((v) => [v.x, v.y, v.z]));
      for (const [mat, order] of [
        [mats.halo, 1],
        [s.emphasis ? mats.lineEm : mats.line, 2],
      ] as const) {
        const line = new Line2(geo, mat);
        line.computeLineDistances();
        line.renderOrder = OVERLAY_ORDER + order;
        group.add(line);
      }
    }
    for (const v of pts) {
      const dot = new THREE.Sprite(s.emphasis ? mats.dotEm : mats.dot);
      dot.position.copy(v);
      dot.renderOrder = OVERLAY_ORDER + 2;
      dot.scale.setScalar(dotScale.v);
      sprites.push(dot);
      group.add(dot);
    }
  }

  function clear(group: THREE.Group) {
    const geos = new Set<THREE.BufferGeometry>();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) geos.add(o.geometry); // sprites share three's own quad: never disposed
    });
    geos.forEach((g) => g.dispose());
    for (const child of [...group.children]) {
      group.remove(child);
      const i = sprites.indexOf(child as THREE.Sprite);
      if (i >= 0) sprites.splice(i, 1);
    }
  }

  // ---- per frame: constant pixel sizes, line resolution, label positions
  const size = new THREE.Vector2();
  const p = new THREE.Vector3();
  let disposed = false;
  const place = (l: Label, w: number, h: number) => {
    p.copy(l.at).project(stage.camera);
    const on = p.z > -1 && p.z < 1;
    l.el.style.visibility = on ? "visible" : "hidden";
    if (on) l.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
  };
  stage.onFrame(() => {
    if (disposed) return;
    stage.renderer.getSize(size);
    const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2))) / Math.max(size.y, 1);
    dotScale.v = DOT_PX * perPx;
    dotScale.ring = RING_PX * perPx;
    for (const s of sprites) s.scale.setScalar(dotScale.v);
    hover.scale.setScalar(dotScale.ring);
    for (const m of lineMats) m.resolution.set(size.x, size.y);
    for (const l of labels) place(l, size.x, size.y);
    for (const l of draftLabels) place(l, size.x, size.y);
  });

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  return {
    canvas,
    spacing: index.spacing,
    pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, stage.camera);
      const { origin: o, direction: d } = raycaster.ray;
      const angle = (PICK_PX * 2 * Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2))) / rect.height;
      const hit = index.pick({ origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] }, { angle, minRadius: index.spacing / 2 });
      if (!hit) return null;
      const sx = cloud.positions[hit.index * 3], sz = cloud.positions[hit.index * 3 + 2];
      const [e, n] = sceneToSurvey(cloud, sx, 0, sz);
      return [e, n, index.groundAt(sx, sz) ?? cloud.z[hit.index]];
    },
    groundAt(e, n) {
      return index.groundAt(e - cloud.origin.x, -(n - cloud.origin.y));
    },
    project(pt) {
      p.copy(sv(pt)).project(stage.camera);
      if (p.z <= -1 || p.z >= 1) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    },
    setShapes(shapes) {
      clear(shapesGroup);
      labels.forEach((l) => l.el.remove());
      labels = [];
      for (const s of shapes) {
        build(shapesGroup, s);
        const l = makeLabel(s);
        if (l) labels.push(l);
      }
    },
    setDraft(shape) {
      clear(draftGroup);
      draftLabels.forEach((l) => l.el.remove());
      draftLabels = [];
      if (!shape) return;
      build(draftGroup, shape);
      const l = makeLabel(shape);
      if (l) draftLabels.push(l);
    },
    setHover(pt) {
      hover.visible = pt !== null;
      if (pt) hover.position.copy(sv(pt));
    },
    setAccent(hex) {
      accentColor.set(hex);
      mats.lineEm.color.set(hex);
      mats.fillEm.color.set(hex);
      mats.dotEm.color.set(hex);
      mats.ring.color.set(hex);
    },
    setCursor(cursor) {
      canvas.style.cursor = cursor;
    },
    dispose() {
      disposed = true;
      clear(shapesGroup);
      clear(draftGroup);
      stage.scene.remove(root);
      labelLayer.remove();
      Object.values(mats).forEach((m) => {
        if ("map" in m && m.map) m.map.dispose();
        m.dispose();
      });
      canvas.style.cursor = "";
    },
  };
}
