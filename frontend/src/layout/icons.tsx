// Minimal stroke icon set (24px grid, currentColor) for toolbars and the rail.
import type { ReactNode } from "react";

export type IconName =
  | "folder" | "terrain" | "cloudColor" | "maps" | "chart"
  | "cube" | "top" | "front" | "reset" | "grid" | "points" | "slice" | "close" | "chevronUp" | "plus" | "collapse" | "trash" | "palette"
  | "surface" | "opacity" | "layers" | "eye" | "eyeOff" | "lock" | "unlock" | "move" | "rotate" | "sliders" | "excavator";

const PATHS: Record<IconName, ReactNode> = {
  folder: <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />,
  terrain: (
    <>
      <path d="M2.5 18.5 8.5 9l4 6 2.5-3.5 6.5 7z" />
      <path d="M2.5 21.5h19" />
    </>
  ),
  cloudColor: (
    <>
      <circle cx="7" cy="8" r="1.4" />
      <circle cx="12" cy="6" r="1.4" />
      <circle cx="17" cy="9" r="1.4" />
      <circle cx="9" cy="13" r="1.4" />
      <circle cx="15" cy="14" r="1.4" />
      <path d="M4 19.5h16" strokeDasharray="2 2.5" />
    </>
  ),
  maps: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  chart: <path d="M4 20V10m5.5 10V5m5.5 15v-7m5.5 7V8M2.5 20.5h19" />,
  cube: (
    <>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  top: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M12 8v8m-3-3 3 3 3-3" />
    </>
  ),
  front: (
    <>
      <path d="M3 19.5h18" />
      <path d="M5 19.5v-6l4-4 3 3 4-5 3 3v9" />
    </>
  ),
  reset: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 4.5v4h4" />
    </>
  ),
  grid: <path d="M3 9h18M3 15h18M9 3v18M15 3v18M3 3h18v18H3z" />,
  points: (
    <>
      <circle cx="6" cy="17" r="1" />
      <circle cx="11" cy="12" r="2" />
      <circle cx="17.5" cy="7" r="3" />
    </>
  ),
  slice: (
    <>
      <path d="M3 17c3-1 4-5 7-5s3.5 3 6 3 3-2 5-2" />
      <path d="M12 3v18" strokeDasharray="2 2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  surface: (
    <>
      <path d="M2.5 15.5 8 9.5l4.5 3 4-4.5 5 4.5" />
      <path d="M2.5 15.5 7 19l5.5-3.5 4 1.5 5-4.5M8 9.5 7 19m5.5-6.5v3m4-7.5 0 8.5" />
    </>
  ),
  opacity: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17M12 6h4M12 9h6.5M12 12h8.5M12 15h6.5M12 18h4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 9 4.5-9 4.5L3 8z" />
      <path d="m3 12 9 4.5 9-4.5M3 16l9 4.5 9-4.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16M9.9 5.8A8.9 8.9 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a16 16 0 0 1-3 3.7M6.2 7.4A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a8.8 8.8 0 0 0 4-.9" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  move: <path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />,
  rotate: (
    <>
      <path d="M19.5 12A7.5 7.5 0 1 1 12 4.5h3" />
      <path d="m13 2 2.5 2.5L13 7" />
    </>
  ),
  excavator: (
    <>
      <path d="M2.5 19.5h11" />
      <rect x="3" y="13" width="9" height="4" rx="1" />
      <path d="M5 13v-3h4l1.5 3" />
      <path d="M10.5 11 15 5.5l4 3.5" />
      <path d="M19 9v4.5l-2.5 2.5h-2.5l1.5-3" />
      <circle cx="5" cy="19.5" r="0.8" />
      <circle cx="10.5" cy="19.5" r="0.8" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1.2" />
      <circle cx="10" cy="7" r="1.2" />
      <circle cx="14.5" cy="7" r="1.2" />
    </>
  ),
  collapse: <path d="m11 17-5-5 5-5m7 10-5-5 5-5" />,
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7" />
      <path d="M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
