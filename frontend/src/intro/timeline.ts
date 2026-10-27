// Launch intro timeline. One clock (seconds) drives the 3D shot, the HUD and
// the wordmark, so every frame is a pure function of t and skipping is a jump.

export type Span = readonly [start: number, end: number];

export const T = {
  lidsOpen: [0.3, 1.3], // dock lids swing open above the drone
  eyeOpen: [0.5, 1.4], // the drone's camera "eye" opens on the scene
  hudOn: [0.6, 1.0],
  launch: [1.5, 3.9], // first person: shot up out of the dock
  hudOff: [4.8, 5.3],
  scan: [5.6, 9.4], // drone sweeps the site; points appear behind the scan line
  pullAway: [5.0, 8.0], // once the flyover starts, the camera arcs off the drone into the wide shot
  exit: [9.4, 11.2], // drone climbs away out of shot
  gather: [9.7, 12.4], // the scanned points lift off and fly up to form the wordmark
  worldOut: [10.2, 11.8], // the site fades to black behind them
  wordIn: [12.2, 12.6], // crisp wordmark takes over from the particles
  tagline: [12.4, 12.9], // then held ~2 s before docking
  dock: [14.8, 15.7], // wordmark glides to the top-bar brand
  appIn: [15.2, 15.9], // home screen fades up behind it
} as const satisfies Record<string, Span>;

export const INTRO_END = T.appIn[1];
/** Skipping jumps here: the wordmark is formed and about to dock. */
export const SKIP_TO = T.dock[0];
/** After this the 3D scene is hidden and can be released. */
export const SCENE_END = T.wordIn[1];

/** 0 → 1 across a span, clamped. */
export function progress(t: number, [start, end]: Span): number {
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}

export const ease = {
  linear: (x: number) => x,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  inCubic: (x: number) => x * x * x,
  smoother: (x: number) => x * x * x * (x * (x * 6 - 15) + 10), // zero velocity and acceleration at both ends
};

export type Easing = (x: number) => number;

export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
