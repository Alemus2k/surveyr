// The drone's LiDAR at work: a fan of light from the pod to a scan line on
// the ground, and the point cloud that appears behind it — fresh points flash
// in the accent, then settle into the app's elevation colours. Once the site
// is scanned the same points lift off and fly to the screen to spell the
// wordmark (targets are in screen pixels, so they land on the DOM text).
import * as THREE from "three";
import { elevationRamp } from "../color";
import { sampleSite, SITE, surfaceHeight } from "./jobsite";

const POINT_SPACING = 1.05; // m
const POINT_SIZE = 0.75; // m, world-space
const FRESH_LENGTH = 16; // m behind the scan line that points stay "fresh"
const FAN_SAMPLES = 64;
const FAR = 1e6; // stands in for ±∞ in the shader
const GLYPH_POINT_PX = 2.1; // CSS px per point once it's part of a letter
const LIFT = 14; // m points rise before flying to the camera
const STAGGER = 0.45; // share of the gather spent staggering departures
const INK = 0xf2f2f2; // matches the wordmark's colour on black

const vertexShader = /* glsl */ `
  uniform float uScanX;
  uniform float uScale;
  uniform vec3 uAccent;
  uniform vec3 uInk;
  uniform float uGather;
  uniform vec2 uViewport;
  uniform vec2 uOrigin;
  uniform float uFontPx;
  uniform float uPixelRatio;
  attribute vec3 color;
  attribute vec2 aGlyph;
  attribute float aDelay;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float behind = uScanX - position.x;
    float fresh = 1.0 - smoothstep(0.0, ${FRESH_LENGTH.toFixed(1)}, behind);
    float f = clamp((uGather - aDelay * ${STAGGER.toFixed(2)}) / ${(1 - STAGGER).toFixed(2)}, 0.0, 1.0);
    float lift = smoothstep(0.0, 0.35, f);
    float fly = smoothstep(0.2, 1.0, f);
    fly = fly * fly * (3.0 - 2.0 * fly);

    vec3 p = position + vec3(0.0, 0.25 + fresh * 0.8 + lift * ${LIFT.toFixed(1)}, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    vec2 px = uOrigin + aGlyph * uFontPx;
    vec3 target = vec3(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, -0.98);
    vec3 ndc = mix(clip.xyz / clip.w, target, fly);
    ndc.y += sin(fly * 3.14159) * 0.08; // a gentle arc up to the word
    gl_Position = vec4(ndc, 1.0);

    float worldSize = ${POINT_SIZE.toFixed(2)} * (1.0 + 1.2 * fresh) * uScale / -mv.z;
    gl_PointSize = behind < 0.0 ? 0.0 : mix(worldSize, ${GLYPH_POINT_PX.toFixed(2)} * uPixelRatio, fly);

    vec3 c = mix(color, uAccent * 1.35, fresh * 0.85);
    c = mix(c, uAccent * 1.3, sin(fly * 3.14159) * 0.55);
    vColor = mix(c, uInk, smoothstep(0.65, 1.0, fly));
    vAlpha = smoothstep(0.0, 1.5, behind);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uFade;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    gl_FragColor = vec4(vColor, vAlpha * (1.0 - uFade) * (1.0 - smoothstep(0.12, 0.25, d)));
  }
`;

/** Where the wordmark sits on screen, in CSS px. */
export interface WordAnchor {
  originX: number; // left end of the baseline
  originY: number;
  fontPx: number;
  width: number; // viewport
  height: number;
}

export interface ScanEffect {
  group: THREE.Group;
  /** Scan line at `scanX` (±Infinity = none / all), fan from `apex`, fan opacity 0..1. */
  update: (scanX: number, apex: THREE.Vector3, fan: number) => void;
  /** 0 → 1: the points lift off and form the word. `fade` 0 → 1 hands over to the DOM text. */
  gather: (g: number, fade: number) => void;
  /** Letter shapes to land on (em, from glyphs.ts) and where the word is on screen. */
  setWord: (glyphs: Float32Array | null, anchor: WordAnchor) => void;
  /** Pixels per metre at distance 1, for point sizes: viewport height / (2·tan(fov/2)). */
  setScale: (s: number, pixelRatio: number) => void;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function buildPoints(accent: THREE.Color) {
  const positions = sampleSite(POINT_SPACING);
  const n = positions.length / 3;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, positions[i * 3 + 1]);
    hi = Math.max(hi, positions[i * 3 + 1]);
  }
  const colors = new Float32Array(n * 3);
  const delays = new Float32Array(n);
  const rand = seeded(7);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = elevationRamp((positions[i * 3 + 1] - lo) / (hi - lo));
    colors.set([r / 255, g / 255, b / 255], i * 3);
    // leave roughly in scan order (left to right), with scatter
    delays[i] = 0.35 * ((positions[i * 3] + SITE.halfX) / (2 * SITE.halfX)) + 0.65 * rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aGlyph", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geo.setAttribute("aDelay", new THREE.BufferAttribute(delays, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uScanX: { value: -FAR },
      uScale: { value: 500 },
      uAccent: { value: accent },
      uInk: { value: new THREE.Color(INK) },
      uGather: { value: 0 },
      uFade: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uOrigin: { value: new THREE.Vector2() },
      uFontPx: { value: 80 },
      uPixelRatio: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  return { points: new THREE.Points(geo, material), material, geo };
}

/** Give every point a spot inside a letter (many points per spot keeps the letters solid). */
function assignGlyphs(geo: THREE.BufferGeometry, glyphs: Float32Array) {
  const attr = geo.attributes.aGlyph as THREE.BufferAttribute;
  const out = attr.array as Float32Array;
  const spots = glyphs.length / 2;
  if (spots === 0) return;
  const rand = seeded(11);
  const jitter = 0.006; // em
  for (let i = 0; i < attr.count; i++) {
    const k = Math.floor(rand() * spots);
    out[i * 2] = glyphs[k * 2] + (rand() - 0.5) * jitter;
    out[i * 2 + 1] = glyphs[k * 2 + 1] + (rand() - 0.5) * jitter;
  }
  attr.needsUpdate = true;
}

export function buildScanEffect(accentHex: string): ScanEffect {
  const accent = new THREE.Color(accentHex);
  const group = new THREE.Group();
  const { points, material, geo } = buildPoints(accent);
  points.frustumCulled = false;
  points.renderOrder = 10; // over the site, and over the fade that hides it

  // fan: triangle fan from the pod (vertex 0) to the scan line
  const fanPos = new Float32Array((FAN_SAMPLES + 1) * 3);
  const fanGeo = new THREE.BufferGeometry();
  fanGeo.setAttribute("position", new THREE.BufferAttribute(fanPos, 3));
  const index: number[] = [];
  for (let i = 1; i < FAN_SAMPLES; i++) index.push(0, i, i + 1);
  fanGeo.setIndex(index);
  const fanMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fan = new THREE.Mesh(fanGeo, fanMat);
  fan.frustumCulled = false;

  const linePos = new Float32Array(FAN_SAMPLES * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: accent.clone().lerp(new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 0 });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;

  group.add(points, fan, line);
  const u = material.uniforms;

  return {
    group,
    update(scanX, apex, opacity) {
      u.uScanX.value = Number.isFinite(scanX) ? scanX : Math.sign(scanX) * FAR;
      fanMat.opacity = 0.16 * opacity;
      lineMat.opacity = opacity;
      fan.visible = line.visible = opacity > 0 && Number.isFinite(scanX);
      if (!fan.visible) return;
      const x = Math.min(Math.max(scanX, -SITE.halfX), SITE.halfX);
      apex.toArray(fanPos, 0);
      for (let i = 0; i < FAN_SAMPLES; i++) {
        const z = -SITE.halfZ + (2 * SITE.halfZ * i) / (FAN_SAMPLES - 1);
        const y = surfaceHeight(x, z) + 0.3;
        fanPos.set([x, y, z], (i + 1) * 3);
        linePos.set([x, y, z], i * 3);
      }
      fanGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.position.needsUpdate = true;
    },
    gather(g, fade) {
      u.uGather.value = g;
      u.uFade.value = fade;
      // in flight the points cross the depth of the whole scene: draw them over everything
      material.depthTest = g === 0;
    },
    setWord(glyphs, anchor) {
      if (glyphs) assignGlyphs(geo, glyphs);
      u.uViewport.value.set(anchor.width, anchor.height);
      u.uOrigin.value.set(anchor.originX, anchor.originY);
      u.uFontPx.value = anchor.fontPx;
    },
    setScale(s, pixelRatio) {
      u.uScale.value = s;
      u.uPixelRatio.value = pixelRatio;
    },
  };
}
