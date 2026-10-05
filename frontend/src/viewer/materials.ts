// Custom materials for the 3D views.
//
// Points: "density" transparency. Each point carries a fixed random value and
// is drawn only if it is below the layer's opacity, so 40 % opacity shows a
// stable 40 % of the points. Points stay opaque, write depth and need no
// sorting, so overlapping layers composite correctly from every angle.
//
// Surfaces: two passes. A depth-only prepass keeps just the nearest surface,
// then the colour pass blends it at the chosen opacity, so a translucent
// surface never shows its own folds stacked up as darker blotches. A plan-view
// grid (constant spacing in x/z) is drawn on top: on slopes its cells stretch,
// which makes gradient and vertical exaggeration easy to read.
import * as THREE from "three";

// ------------------------------------------------------------------ points

const POINTS_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aRand;
  uniform float uSize;
  uniform float uScale;
  uniform float uOpacity;
  uniform vec3 uSolid;
  uniform float uUseSolid;
  varying vec3 vColor;
  varying float vKeep;
  #include <fog_pars_vertex>
  void main() {
    vColor = mix(aColor, uSolid, uUseSolid);
    vKeep = step(aRand, uOpacity);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * (uScale / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const POINTS_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vKeep;
  #include <fog_pars_fragment>
  void main() {
    if (vKeep < 0.5) discard;
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard; // round dots
    gl_FragColor = vec4(vColor, 1.0);
    #include <fog_fragment>
  }
`;

export interface PointsMaterialOptions {
  size: number; // world-space dot diameter
  opacity?: number;
  solid?: string | null; // flat layer colour instead of per-point colour
}

export function createPointsMaterial({ size, opacity = 1, solid = null }: PointsMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSize: { value: size },
        uScale: { value: 400 },
        uOpacity: { value: opacity },
        uSolid: { value: new THREE.Color(solid ?? "#ffffff") },
        uUseSolid: { value: solid ? 1 : 0 },
      },
    ]),
  });
}

export function setPointsSolid(mat: THREE.ShaderMaterial, solid: string | null): void {
  mat.uniforms.uUseSolid.value = solid ? 1 : 0;
  if (solid) (mat.uniforms.uSolid.value as THREE.Color).set(solid);
}

/** Size attenuation needs half the drawing-buffer height (same rule as THREE.PointsMaterial). */
export function setPointsViewportHeight(mat: THREE.ShaderMaterial, renderer: THREE.WebGLRenderer): void {
  mat.uniforms.uScale.value = renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2;
}

/** Stable per-point random values (seeded, so thinning doesn't change between loads). */
export function randomAttribute(count: number, seed = 1): THREE.BufferAttribute {
  const out = new Float32Array(count);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < count; i++) {
    s ^= s << 13; // xorshift32
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = (s >>> 0) / 4294967296;
  }
  return new THREE.BufferAttribute(out, 1);
}

// ------------------------------------------------------------------ surfaces

const SURFACE_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormalView;
  #include <fog_pars_vertex>
  void main() {
    vColor = aColor;
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormalView = normalize(normalMatrix * normal);
    // same arithmetic as three's built-in materials (the depth prepass), so the
    // two passes produce bit-identical depths and never z-fight
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform float uGridStep;
  uniform float uGridStrength;
  uniform vec3 uGridColor;
  uniform vec3 uSolid;
  uniform float uUseSolid;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormalView;
  #include <fog_pars_fragment>

  // anti-aliased lines at every multiple of uGridStep in world x/z
  float gridLine(vec2 p) {
    vec2 d = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    return 1.0 - min(min(d.x, d.y), 1.0);
  }

  void main() {
    vec3 n = normalize(vNormalView);
    if (!gl_FrontFacing) n = -n;
    // camera-relative key light + ambient so relief reads from any angle
    float light = 0.42 + 0.58 * max(dot(n, normalize(vec3(0.35, 0.75, 0.55))), 0.0);
    vec3 base = mix(vColor, uSolid, uUseSolid) * light;
    float g = gridLine(vWorld.xz / uGridStep) * uGridStrength;
    gl_FragColor = vec4(mix(base, uGridColor, g), uOpacity);
    #include <fog_fragment>
  }
`;

export interface SurfaceMaterials {
  prepass: THREE.MeshBasicMaterial;
  shade: THREE.ShaderMaterial;
}

export interface SurfaceOptions {
  opacity: number;
  gridStep: number; // world units between grid lines
  solid?: string | null;
}

const GRID_COLOR = "#ffffff";
const GRID_STRENGTH = 0.55;

export function createSurfaceMaterials({ opacity, gridStep, solid = null }: SurfaceOptions): SurfaceMaterials {
  // transparent: true so both passes sort together with other translucent layers
  const prepass = new THREE.MeshBasicMaterial({
    colorWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
    // push recorded depth back a hair so the colour pass always wins the LessEqual test
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const shade = new THREE.ShaderMaterial({
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    fog: true,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uOpacity: { value: opacity },
        uGridStep: { value: gridStep },
        uGridStrength: { value: GRID_STRENGTH },
        uGridColor: { value: new THREE.Color(GRID_COLOR) },
        uSolid: { value: new THREE.Color(solid ?? "#ffffff") },
        uUseSolid: { value: solid ? 1 : 0 },
      },
    ]),
  });
  return { prepass, shade };
}

export function setSurfaceSolid(mats: SurfaceMaterials, solid: string | null): void {
  mats.shade.uniforms.uUseSolid.value = solid ? 1 : 0;
  if (solid) (mats.shade.uniforms.uSolid.value as THREE.Color).set(solid);
}

/** Two meshes sharing one geometry: depth prepass, then the shaded colour pass. */
export function surfaceMeshes(geo: THREE.BufferGeometry, mats: SurfaceMaterials): THREE.Group {
  const group = new THREE.Group();
  const depth = new THREE.Mesh(geo, mats.prepass);
  depth.renderOrder = 0;
  const shade = new THREE.Mesh(geo, mats.shade);
  shade.renderOrder = 1;
  group.add(depth, shade);
  return group;
}
