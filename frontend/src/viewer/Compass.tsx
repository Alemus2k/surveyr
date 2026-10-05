import { useCallback, useRef } from "react";

/**
 * Compass dial driven straight from the render loop (no React re-render per
 * frame): pass ``onHeading`` to the scene, render ``<Compass dialRef …/>``.
 */
export function useCompass() {
  const dialRef = useRef<HTMLDivElement>(null);
  const onHeading = useCallback((radians: number) => {
    if (dialRef.current) dialRef.current.style.transform = `rotate(${radians}rad)`;
  }, []);
  return { dialRef, onHeading };
}

interface CompassProps {
  dialRef: React.RefObject<HTMLDivElement>;
  onTopView: () => void;
}

export function Compass({ dialRef, onTopView }: CompassProps) {
  return (
    <div className="compass">
      <div ref={dialRef} className="compass-dial" aria-hidden="true">
        <span className="compass-n">N</span>
        <span className="compass-e">E</span>
        <span className="compass-s">S</span>
        <span className="compass-w">W</span>
      </div>
      <button className="compass-top" onClick={onTopView} title="Top view">
        top
      </button>
    </div>
  );
}
