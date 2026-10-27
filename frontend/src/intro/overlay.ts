// The 2D layers over the intro's 3D shot: the eye opening, the drone HUD, and
// the crisp wordmark that takes over from the particles and docks into the top bar. Each frame is
// written straight to the DOM (opacity / transform / clip-path), no React renders.
import { ease, lerp, progress, T } from "./timeline";

export interface OverlayElements {
  root: HTMLElement; // black backdrop; fades as the app appears
  canvas: HTMLElement;
  lids: SVGPathElement;
  seam: SVGPathElement;
  hud: HTMLElement;
  altitude: HTMLElement;
  status: HTMLElement;
  word: HTMLElement;
  wordmark: HTMLElement;
  tagline: HTMLElement;
  skip: HTMLElement;
}

/** Selector for the top-bar brand the wordmark lands on. */
export const BRAND_TARGET = ".topbar-brand .brand-name";
const EYE_FULL_OPEN = 1.7; // aperture half-height as a multiple of the viewport height

const statusAt = (t: number) => (t < T.launch[0] ? "Systems check" : t < T.launch[0] + 0.9 ? "Launch" : "Climb");

function eyePaths(w: number, h: number, open: number) {
  const a = open * h * EYE_FULL_OPEN;
  const cy = h / 2;
  const x0 = -0.1 * w;
  const x1 = 1.1 * w;
  const almond = `M${x0} ${cy} Q${w / 2} ${cy - 2 * a} ${x1} ${cy} Q${w / 2} ${cy + 2 * a} ${x0} ${cy} Z`;
  return { lids: `M0 0H${w}V${h}H0Z ${almond}`, seam: almond };
}

interface DockMove {
  dx: number;
  dy: number;
  scale: number;
  from: [number, number, number];
  to: [number, number, number];
}

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/\d+(\.\d+)?/g);
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
}

/** FLIP from the centred wordmark to the top-bar brand; null if the brand isn't on screen. */
function measureDock(word: HTMLElement): DockMove | null {
  const target = document.querySelector<HTMLElement>(BRAND_TARGET);
  const to = target?.getBoundingClientRect();
  if (!target || !to || to.width === 0) return null;
  const from = word.getBoundingClientRect();
  const scale = parseFloat(getComputedStyle(target).fontSize) / parseFloat(getComputedStyle(word).fontSize);
  return {
    dx: to.left - from.left,
    dy: to.top + to.height / 2 - (from.top + (from.height * scale) / 2),
    scale,
    from: parseRgb(getComputedStyle(word).color),
    to: parseRgb(getComputedStyle(target).color),
  };
}

export function createOverlay(el: OverlayElements) {
  let dock: DockMove | null | undefined; // undefined: not measured yet
  let lastStatus = "";
  let lastAlt = "";

  return {
    frame(t: number, altitude: number) {
      const w = el.root.clientWidth;
      const h = el.root.clientHeight;

      // the drone's eye: a lit seam, a flash, then the lids part
      const open = ease.outCubic(progress(t, T.eyeOpen));
      const { lids, seam } = eyePaths(w, h, open);
      el.lids.setAttribute("d", lids);
      el.seam.setAttribute("d", seam);
      el.seam.style.opacity = String(progress(t, [0.15, 0.5]) * (1 - progress(t, [T.eyeOpen[0] + 0.3, T.eyeOpen[1]])));
      el.lids.parentElement!.style.display = open >= 1 ? "none" : "";

      // first-person HUD, flickering on
      const on = progress(t, T.hudOn);
      const flicker = on < 1 && Math.sin(t * 95) > 0.2 ? 0.35 : 1;
      el.hud.style.opacity = String(on * flicker * (1 - progress(t, T.hudOff)));
      const alt = `${Math.max(0, altitude).toFixed(1)}`;
      if (alt !== lastAlt) el.altitude.textContent = lastAlt = alt;
      const status = statusAt(t);
      if (status !== lastStatus) el.status.textContent = lastStatus = status;

      // the particles have formed the word: the crisp text takes over exactly on top of them
      el.word.style.visibility = t >= T.wordIn[0] ? "visible" : "hidden";
      el.wordmark.style.opacity = String(progress(t, T.wordIn));
      el.canvas.style.visibility = t < T.wordIn[1] ? "visible" : "hidden";
      el.tagline.style.opacity = String(progress(t, T.tagline) * (1 - progress(t, [T.dock[0], T.dock[0] + 0.3])));

      el.skip.style.visibility = t < T.dock[0] ? "visible" : "hidden";

      // dock into the top bar as the home screen appears
      if (t >= T.dock[0]) {
        if (dock === undefined) dock = measureDock(el.wordmark);
        const e = ease.inOutCubic(progress(t, T.dock));
        if (dock) {
          el.wordmark.style.transform = `translate(${dock.dx * e}px, ${dock.dy * e}px) scale(${lerp(1, dock.scale, e)})`;
          const c = dock.from.map((v, i) => Math.round(lerp(v, dock!.to[i], e)));
          el.wordmark.style.color = `rgb(${c.join(",")})`;
        } else {
          el.wordmark.style.opacity = String(1 - e);
        }
      }
      el.root.style.backgroundColor = `rgba(0, 0, 0, ${1 - ease.inOutCubic(progress(t, T.appIn))})`;
    },
  };
}
