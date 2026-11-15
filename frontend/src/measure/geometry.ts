// Measurement maths, in true survey coordinates: easting, northing, elevation
// (metres). Nothing here knows about the 3D scene, except sceneToSurvey, which
// undoes the viewer's centring and vertical exaggeration.

/** A surveyed spot: [easting, northing, elevation], metres. */
export type Vec3 = [number, number, number];
/** A plan position: [easting, northing], metres. */
export type Vec2 = [number, number];

// ------------------------------------------------------------------ scene ↔ survey

/** What sceneToSurvey needs from a prepared cloud. */
export interface SceneFrame {
  origin: { x: number; y: number; z: number };
  exaggeration: number;
}

/**
 * Scene position → survey coordinates. The viewer maps survey (x, y, z) to
 * scene (x − ox, (z − oz)·exaggeration, −(y − oy)); this is its exact inverse,
 * so a measurement never carries the vertical stretch of a flat site.
 */
export function sceneToSurvey(frame: SceneFrame, sx: number, sy: number, sz: number): Vec3 {
  return [frame.origin.x + sx, frame.origin.y - sz, frame.origin.z + sy / frame.exaggeration];
}

// ------------------------------------------------------------------ two points

export const horizontalDistance = (a: Vec3 | Vec2, b: Vec3 | Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export const slopeDistance = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** Plan distances shorter than this have no meaningful direction or grade. */
const MIN_RUN = 1e-6;

/** Azimuth from a to b in degrees clockwise from grid north, 0 ≤ az < 360 (null when a and b coincide in plan). */
export function azimuthDeg(a: Vec3 | Vec2, b: Vec3 | Vec2): number | null {
  const de = b[0] - a[0], dn = b[1] - a[1];
  if (Math.hypot(de, dn) < MIN_RUN) return null;
  const az = (Math.atan2(de, dn) * 180) / Math.PI;
  return az < 0 ? az + 360 : az >= 360 ? az - 360 : az;
}

export interface DistanceResult {
  horizontal: number; // m, in plan
  vertical: number; // m, b − a (positive = B is higher)
  slope: number; // m, straight line through the air
  gradePct: number | null; // rise over run × 100, signed like vertical; null when straight up
  azimuth: number | null; // degrees from grid north, a → b
}

export function measureDistance(a: Vec3, b: Vec3): DistanceResult {
  const horizontal = horizontalDistance(a, b);
  const vertical = b[2] - a[2];
  return {
    horizontal,
    vertical,
    slope: slopeDistance(a, b),
    gradePct: horizontal < MIN_RUN ? null : (vertical / horizontal) * 100,
    azimuth: azimuthDeg(a, b),
  };
}

// ------------------------------------------------------------------ paths

export interface PathResult {
  legs: DistanceResult[];
  horizontal: number; // m, total in plan
  slope: number; // m, total along the legs
  vertical: number; // m, last − first
  climb: number; // m, sum of the rises
  descent: number; // m, sum of the falls (positive)
}

export function measurePath(points: Vec3[]): PathResult {
  const legs: DistanceResult[] = [];
  for (let i = 1; i < points.length; i++) legs.push(measureDistance(points[i - 1], points[i]));
  const sum = (f: (l: DistanceResult) => number) => legs.reduce((s, l) => s + f(l), 0);
  return {
    legs,
    horizontal: sum((l) => l.horizontal),
    slope: sum((l) => l.slope),
    vertical: points.length > 1 ? points[points.length - 1][2] - points[0][2] : 0,
    climb: sum((l) => Math.max(l.vertical, 0)),
    descent: sum((l) => Math.max(-l.vertical, 0)),
  };
}

// ------------------------------------------------------------------ polygons

/** Plan area of a polygon (shoelace), any winding, m². The ring is closed implicitly. */
export function polygonArea(ring: (Vec2 | Vec3)[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  // relative to the first vertex: survey eastings are ~10⁵–10⁶ m and the cross terms would lose digits
  const [e0, n0] = ring[0];
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    twice += (p[0] - e0) * (q[1] - n0) - (q[0] - e0) * (p[1] - n0);
  }
  return Math.abs(twice) / 2;
}

/** Plan perimeter of a closed polygon, m. */
export function polygonPerimeter(ring: (Vec2 | Vec3)[]): number {
  if (ring.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < ring.length; i++) p += horizontalDistance(ring[i], ring[(i + 1) % ring.length]);
  return ring.length === 2 ? p / 2 : p;
}

/** Whether plan point (e, n) is inside the ring (even–odd rule). */
export function pointInPolygon(e: number, n: number, ring: (Vec2 | Vec3)[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > n !== yj > n && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ground elevation at a plan position, or null where nothing was scanned. */
export type HeightAt = (e: number, n: number) => number | null;

export interface SurfaceResult {
  planArea: number; // m², exact (shoelace)
  surfaceArea: number | null; // m², over the ground; null when nothing inside was scanned
  meanElevation: number | null; // m, average ground elevation inside
  minElevation: number | null;
  maxElevation: number | null;
  coverage: number; // 0..1, share of the outline with ground under it
  cell: number; // m, sampling step used
}

/**
 * Plan area, ground surface area and average elevation of a polygon.
 *
 * The ground is sampled on a square grid of ``cell`` metres. Each cell whose
 * centre is inside the outline and whose four corners have ground is split
 * into two triangles; the ratio (sum of the triangles' true 3D areas) / (sum
 * of their plan areas) is the outline's roughness, and surface area =
 * plan area (exact, shoelace) × that ratio. A plane at any tilt therefore
 * comes out exact (a 45° roof is √2 × plan) whatever the cell size, and
 * cells partly outside the outline don't bias the total. Cells without ground
 * are left out of the ratio and reported through ``coverage``.
 */
export function measureSurface(ring: Vec3[], heightAt: HeightAt, cell: number): SurfaceResult {
  const planArea = polygonArea(ring);
  const empty: SurfaceResult = {
    planArea, surfaceArea: null, meanElevation: null, minElevation: null, maxElevation: null, coverage: 0, cell,
  };
  if (ring.length < 3 || !(cell > 0)) return empty;
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const [e, n] of ring) {
    e0 = Math.min(e0, e); e1 = Math.max(e1, e);
    n0 = Math.min(n0, n); n1 = Math.max(n1, n);
  }
  const cols = Math.max(1, Math.ceil((e1 - e0) / cell));
  const rows = Math.max(1, Math.ceil((n1 - n0) / cell));
  // corner heights, sampled once and shared by neighbouring cells
  const corner = new Float64Array((cols + 1) * (rows + 1)).fill(NaN);
  const cornerAt = (i: number, j: number): number => {
    const k = j * (cols + 1) + i;
    if (Number.isNaN(corner[k])) corner[k] = heightAt(e0 + i * cell, n0 + j * cell) ?? Infinity;
    return corner[k];
  };
  let inside = 0, covered = 0, area3d = 0, sumZ = 0, zMin = Infinity, zMax = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!pointInPolygon(e0 + (i + 0.5) * cell, n0 + (j + 0.5) * cell, ring)) continue;
      inside++;
      const z00 = cornerAt(i, j), z10 = cornerAt(i + 1, j), z01 = cornerAt(i, j + 1), z11 = cornerAt(i + 1, j + 1);
      if (![z00, z10, z01, z11].every(Number.isFinite)) continue;
      covered++;
      area3d += triangleArea(cell, z00, z10, z11, true) + triangleArea(cell, z00, z11, z01, false);
      const zc = (z00 + z10 + z01 + z11) / 4;
      sumZ += zc;
      zMin = Math.min(zMin, z00, z10, z01, z11);
      zMax = Math.max(zMax, z00, z10, z01, z11);
    }
  }
  if (covered === 0) return { ...empty, coverage: 0 };
  const ratio = area3d / (covered * cell * cell);
  return {
    planArea,
    surfaceArea: planArea * ratio,
    meanElevation: sumZ / covered,
    minElevation: zMin,
    maxElevation: zMax,
    coverage: covered / inside,
    cell,
  };
}

/**
 * 3D area of a right triangle in a grid cell of side ``c``. Lower triangle
 * (0,0)-(c,0)-(c,c) when ``lower``, else (0,0)-(c,c)-(0,c); heights in that order.
 */
function triangleArea(c: number, za: number, zb: number, zc: number, lower: boolean): number {
  // edge vectors from the first vertex
  const u: Vec3 = lower ? [c, 0, zb - za] : [c, c, zb - za];
  const v: Vec3 = lower ? [c, c, zc - za] : [0, c, zc - za];
  const x = u[1] * v[2] - u[2] * v[1];
  const y = u[2] * v[0] - u[0] * v[2];
  const z = u[0] * v[1] - u[1] * v[0];
  return Math.hypot(x, y, z) / 2;
}

// ------------------------------------------------------------------ ground snap

/** Median of a list (NaN when empty); the list is not modified. */
export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return NaN;
  const s = Array.from(values).sort((a, b) => a - b);
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Ground elevation at a plan position from scattered points: the median
 * elevation of the ``k`` points nearest in plan (within ``maxRadius``), so one
 * stray return (a bird, a stake, a noisy shot) can't move it. Brute force —
 * the viewer uses the indexed version in groundIndex.ts, which matches this.
 */
export function groundSnap(points: Vec3[], e: number, n: number, k: number, maxRadius = Infinity): number | null {
  const near = points
    .map((p) => ({ d: Math.hypot(p[0] - e, p[1] - n), z: p[2] }))
    .filter((p) => p.d <= maxRadius)
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  return near.length ? median(near.map((p) => p.z)) : null;
}

// ------------------------------------------------------------------ angles and grades (unit-free text)

/** Degrees → whole degrees and minutes (and seconds), rounded at the last unit shown. */
export function toDms(deg: number, withSeconds = false): { d: number; m: number; s: number } {
  const units = Math.round(Math.abs(deg) * (withSeconds ? 3600 : 60));
  const perDeg = withSeconds ? 3600 : 60;
  const d = Math.floor(units / perDeg);
  const rest = units - d * perDeg;
  return withSeconds ? { d, m: Math.floor(rest / 60), s: rest % 60 } : { d, m: rest, s: 0 };
}

/** "45°12′" or "45°12′07″". */
export function formatDms(deg: number, withSeconds = false): string {
  const { d, m, s } = toDms(deg, withSeconds);
  const mm = String(m).padStart(2, "0");
  return withSeconds ? `${d}°${mm}′${String(s).padStart(2, "0")}″` : `${d}°${mm}′`;
}

/**
 * A quadrant bearing as surveyors and plans write it: "N 45°12′ E" (measured
 * from north or south toward east or west, 0–90°). Due directions stay in
 * quadrant form ("N 90°00′ E") so the text is always parseable.
 */
export function formatBearing(azimuth: number, withSeconds = false): string {
  // round first, so 89°59′59.9″ becomes "N 90°00′ E" rather than "N 89°60′ E"
  const step = withSeconds ? 1 / 3600 : 1 / 60;
  let az = Math.round((((azimuth % 360) + 360) % 360) / step) * step;
  if (az >= 360 - step / 2) az = 0;
  let ns: "N" | "S", ew: "E" | "W", angle: number;
  if (az <= 90) [ns, ew, angle] = ["N", "E", az];
  else if (az < 180) [ns, ew, angle] = ["S", "E", 180 - az];
  else if (az <= 270) [ns, ew, angle] = ["S", "W", az - 180];
  else [ns, ew, angle] = ["N", "W", 360 - az];
  return `${ns} ${formatDms(angle, withSeconds)} ${ew}`;
}

/** Below this the ground reads as level and a run:rise ratio is meaningless. */
const FLAT_PCT = 0.005;

/** A grade as text: "3.2 %", "0.45 %" (two decimals under 1 %), always unsigned. */
export function formatGradePct(pct: number): string {
  const a = Math.abs(pct);
  return `${a.toFixed(a < 1 ? 2 : 1)} %`;
}

/**
 * Grade as a run:rise ratio, the way slopes are specified on plans:
 * 3.2 % → "31:1", 33.3 % → "3:1", 50 % → "2:1", 200 % → "1:2". Null when level.
 */
export function formatGradeRatio(pct: number): string | null {
  const a = Math.abs(pct);
  if (a < FLAT_PCT) return null;
  const run = 100 / a;
  if (run >= 1) return `${run >= 10 ? Math.round(run) : trim1(run)}:1`;
  const rise = a / 100;
  return `1:${rise >= 10 ? Math.round(rise) : trim1(rise)}`;
}

const trim1 = (v: number): string => String(Number(v.toFixed(1)));
