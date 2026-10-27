// Where an axis measurement chip goes on screen: beside its axis end, but
// always inside the viewport so a chip is never clipped off the edge.

export type AxisKey = "east" | "north" | "up";

export interface Size {
  width: number;
  height: number;
}

export const CHIP_EDGE_PAD = 8; // px kept clear of the viewport edges
export const RIGHT_RESERVE = 64; // px kept clear on the right for the colour scale / layer legend
const GAP = 8; // px between an axis end and its chip
const UP_GAP = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Top-left of the chip (px), given the axis end's projected screen position. */
export function placeAxisChip(key: AxisKey, anchor: { x: number; y: number }, chip: Size, view: Size): { x: number; y: number } {
  let x: number;
  let y: number;
  if (key === "east") {
    x = anchor.x - chip.width - GAP; // left of the free end
    y = anchor.y - chip.height / 2;
  } else if (key === "north") {
    x = anchor.x + GAP; // right of the free end
    y = anchor.y - chip.height / 2;
  } else {
    x = anchor.x - chip.width / 2; // centred above the top of the up axis
    y = anchor.y - chip.height - UP_GAP;
  }
  return {
    x: clamp(x, CHIP_EDGE_PAD, view.width - chip.width - RIGHT_RESERVE),
    y: clamp(y, CHIP_EDGE_PAD, view.height - chip.height - CHIP_EDGE_PAD),
  };
}
