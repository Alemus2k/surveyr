import { useEffect, useRef, type CSSProperties } from "react";
import { sampleWord, type WordGlyphs } from "./glyphs";
import { createIntroScene, type IntroScene } from "./introScene";
import { createOverlay, type OverlayElements } from "./overlay";
import type { WordAnchor } from "./scanEffect";
import { INTRO_END, SCENE_END, SKIP_TO, T } from "./timeline";

const SKIP_KEYS = new Set(["Escape", "Enter", " "]);
/** Dev only: `?introAt=6.5` holds the intro on one frame, for tuning the shot. */
const HOLD_AT = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get("introAt") ?? NaN) : NaN;

const WORD = "Surveyr";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

const PLAYED = "__surveyrIntroPlayed";
/**
 * True the first time it's asked per page load, so the intro plays once when
 * the app opens — not again on a remount or a dev hot reload.
 */
export function claimLaunchIntro(): boolean {
  const w = window as unknown as Record<string, unknown>;
  if (w[PLAYED]) return false;
  w[PLAYED] = true;
  return true;
}

/** Where the DOM wordmark's baseline starts, so the particles land on its letters. */
function wordAnchor(root: HTMLElement, wordmark: HTMLElement, glyphs: WordGlyphs | null): WordAnchor {
  const r = wordmark.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  const fontPx = parseFloat(getComputedStyle(wordmark).fontSize);
  const ascent = (glyphs?.ascent ?? 0.9) * fontPx;
  const descent = (glyphs?.descent ?? 0.25) * fontPx;
  return {
    originX: r.left - box.left,
    originY: r.top - box.top + (r.height - ascent - descent) / 2 + ascent, // line box centres the font's content area
    fontPx,
    width: box.width,
    height: box.height,
  };
}

interface LaunchIntroProps {
  accent: string; // viewport-tuned highlight, for the dock, lens and scan
  onDone: () => void;
}

/**
 * Launch animation: the drone's eye opens in its dock, it launches over a job
 * site, the camera pulls out to watch it scan, it flies at the lens, and the
 * Surveyr wordmark is written and docks into the top bar. Click or Esc skips.
 */
export function LaunchIntro({ accent, onDone }: LaunchIntroProps) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = <E extends Element>(sel: string) => el.querySelector<E>(sel)!;
    const parts: OverlayElements = {
      root: el,
      canvas: q(".intro-canvas"),
      lids: q(".intro-lids"),
      seam: q(".intro-seam"),
      hud: q(".intro-hud"),
      altitude: q(".intro-alt"),
      status: q(".intro-status"),
      word: q(".intro-word"),
      wordmark: q(".intro-wordmark"),
      tagline: q(".intro-tagline"),
      skip: q(".intro-skip"),
    };
    document.documentElement.dataset.intro = "playing";

    let scene: IntroScene | null = null;
    try {
      scene = createIntroScene(parts.canvas, accent);
      scene.resize(el.clientWidth, el.clientHeight);
    } catch {
      scene = null; // no WebGL: go straight to the wordmark
    }
    // the letters the particles land on, in the wordmark's own font once it has loaded
    let glyphs: WordGlyphs | null = null;
    const style = getComputedStyle(parts.wordmark);
    const placeWord = () => scene?.setWord(null, wordAnchor(el, parts.wordmark, glyphs));
    let cancelled = false;
    document.fonts
      .load(`${style.fontWeight} 100px ${style.fontFamily}`)
      .catch(() => [])
      .then(() => {
        if (cancelled) return;
        glyphs = sampleWord(WORD, style.fontWeight, style.fontFamily);
        scene?.setWord(glyphs?.points ?? null, wordAnchor(el, parts.wordmark, glyphs));
      });

    const overlay = createOverlay(parts);
    let start = performance.now() - (scene ? 0 : T.wordIn[0] * 1000);
    let raf = 0;

    const release = () => {
      scene?.dispose();
      scene = null;
    };
    const tick = (now: number) => {
      const t = Number.isFinite(HOLD_AT) ? HOLD_AT : (now - start) / 1000;
      if (scene && t > SCENE_END) release();
      scene?.render(t);
      overlay.frame(t, scene?.altitude(t) ?? 0);
      if (t >= INTRO_END) {
        done.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const skip = () => {
      const t = (performance.now() - start) / 1000;
      if (t < SKIP_TO) start = performance.now() - SKIP_TO * 1000;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!SKIP_KEYS.has(e.key)) return;
      e.preventDefault();
      skip();
    };
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === 0) return;
      scene?.resize(el.clientWidth, el.clientHeight);
      placeWord();
    });
    ro.observe(el);
    window.addEventListener("keydown", onKey);
    el.addEventListener("pointerdown", skip);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      el.removeEventListener("pointerdown", skip);
      release();
      delete document.documentElement.dataset.intro;
    };
  }, [accent]);

  return (
    <div ref={root} className="intro" style={{ "--intro-accent": accent } as CSSProperties}>
      <div className="intro-canvas" aria-hidden="true" />

      <svg className="intro-eye" aria-hidden="true">
        <path className="intro-lids" fillRule="evenodd" />
        <path className="intro-seam" />
      </svg>

      <div className="intro-hud" aria-hidden="true">
        <span className="intro-corner intro-corner-tl" />
        <span className="intro-corner intro-corner-tr" />
        <span className="intro-corner intro-corner-bl" />
        <span className="intro-corner intro-corner-br" />
        <span className="intro-reticle" />
        <div className="intro-readout intro-readout-tl">
          <span>SVR-1</span>
          <span>LiDAR online</span>
        </div>
        <div className="intro-readout intro-readout-bl">
          <span className="intro-status">Systems check</span>
        </div>
        <div className="intro-readout intro-readout-br">
          <span>
            ALT <span className="intro-alt">0.0</span> m
          </span>
        </div>
      </div>

      <div className="intro-word">
        <h1 className="intro-wordmark">{WORD}</h1>
        <p className="intro-tagline">Terrain survey workstation</p>
      </div>

      <button className="intro-skip" onClick={(e) => e.currentTarget.blur()}>
        Click or press Esc to skip
      </button>
    </div>
  );
}
