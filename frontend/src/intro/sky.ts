// Night sky for the intro: a deep-blue dome with a town glow on the northern
// horizon, twinkling stars with a faint Milky Way band, the moon, and the
// moonlight that lights the site.
import * as THREE from "three";
import { seeded } from "./noise";

export const SKY_RADIUS = 3000;
/** Night haze: the sky's horizon colour, so distant ground and buildings fade into it. */
export const HORIZON = 0x1a2133;
const ZENITH = 0x03050b;
const TOWN_GLOW = 0x3b2b22; // sodium light pollution over the town
const TOWN_DIR = new THREE.Vector3(0.15, 0, -1).normalize(); // north, where the town is
/** Where the moon is: ahead of the drone as it sits in its dock, low in the north-east. */
const MOON_DIR = new THREE.Vector3(0.78, 0.3, -0.55).normalize();
const STAR_COUNT = 3200;
const MILKY_WAY_SHARE = 0.35;

function dome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uHorizon: { value: new THREE.Color(HORIZON) },
      uZenith: { value: new THREE.Color(ZENITH) },
      uGlow: { value: new THREE.Color(TOWN_GLOW) },
      uGlowDir: { value: TOWN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGlow; uniform vec3 uGlowDir;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, y));
        float toward = max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), uGlowDir), 0.0);
        c += uGlow * pow(toward, 3.0) * (1.0 - smoothstep(0.0, 0.2, y)) * step(-0.05, y);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), mat);
}

function stars(): { points: THREE.Points; material: THREE.ShaderMaterial } {
  const rand = seeded(5);
  const pos = new Float32Array(STAR_COUNT * 3);
  const size = new Float32Array(STAR_COUNT);
  const phase = new Float32Array(STAR_COUNT);
  // the Milky Way: a great circle tilted across the sky
  const bandNormal = new THREE.Vector3(0.45, 0.35, 0.82).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < STAR_COUNT; i++) {
    do {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
      if (i < STAR_COUNT * MILKY_WAY_SHARE) v.addScaledVector(bandNormal, -v.dot(bandNormal) * (0.88 + rand() * 0.12));
    } while (v.lengthSq() < 0.01 || v.lengthSq() > 1 || v.normalize().y < 0.02);
    v.multiplyScalar(SKY_RADIUS * 0.94).toArray(pos, i * 3);
    const r = rand();
    size[i] = 0.8 + r * r * r * 2.6; // mostly faint, a few bright
    phase[i] = rand() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uPixelRatio;
      attribute float aSize; attribute float aPhase;
      varying float vBright;
      void main() {
        float horizon = smoothstep(0.02, 0.25, normalize(position).y);
        vBright = horizon * (0.55 + 0.45 * sin(uTime * (1.5 + fract(aPhase) * 3.0) + aPhase)) * min(1.0, aSize * 0.55);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vBright;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vBright * (1.0 - smoothstep(0.1, 0.5, d)), 1.0);
      }
    `,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return { points, material };
}

function radialTexture(stops: Array<[number, string]>): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function moon(): THREE.Group {
  const g = new THREE.Group();
  g.position.copy(MOON_DIR).multiplyScalar(SKY_RADIUS * 0.9);
  const disc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([
        [0, "#f4f1e8"],
        [0.42, "#e4e2dc"],
        [0.48, "#d8d8d4"],
        [0.5, "rgba(216,216,212,0)"],
      ]),
      fog: false,
      depthWrite: false,
    })
  );
  disc.scale.setScalar(110);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture([
        [0, "rgba(190,205,255,0.5)"],
        [0.2, "rgba(150,170,230,0.16)"],
        [1, "rgba(120,140,200,0)"],
      ]),
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.setScalar(700);
  g.add(halo, disc);
  return g;
}

export interface NightSky {
  group: THREE.Group;
  /** Lights for the scene: cool moonlight (casts the site's shadows) and sky fill. */
  lights: THREE.Light[];
  update: (t: number, pixelRatio: number) => void;
}

export function buildNightSky(): NightSky {
  const group = new THREE.Group();
  const s = stars();
  group.add(dome(), s.points, moon());

  const moonlight = new THREE.DirectionalLight(0xb7c6ff, 1.25);
  moonlight.position.set(110, 170, -90); // higher than the moon sprite, so the site is lit from above
  moonlight.castShadow = true;
  moonlight.shadow.mapSize.set(2048, 2048);
  const cam = moonlight.shadow.camera;
  cam.left = -190;
  cam.right = 190;
  cam.top = 150;
  cam.bottom = -150;
  cam.near = 10;
  cam.far = 500;
  moonlight.shadow.bias = -0.0008;
  const fill = new THREE.HemisphereLight(0x33426c, 0x17130f, 0.6);

  return {
    group,
    lights: [moonlight, fill],
    update(t, pixelRatio) {
      s.material.uniforms.uTime.value = t;
      s.material.uniforms.uPixelRatio.value = pixelRatio;
    },
  };
}
