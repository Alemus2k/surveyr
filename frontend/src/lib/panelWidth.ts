// Side panel width limits (px).
export const PANEL_MIN = 240;
export const PANEL_MAX = 560;
export const PANEL_DEFAULT = 296;
export const PANEL_KEY_STEP = 16; // arrow-key resize increment
const MAX_SHARE_OF_WINDOW = 0.5; // the viewport always keeps at least half the window

export function clampPanelWidth(width: number, windowWidth: number): number {
  const max = Math.min(PANEL_MAX, Math.floor(windowWidth * MAX_SHARE_OF_WINDOW));
  return Math.round(Math.min(Math.max(width, PANEL_MIN), Math.max(max, PANEL_MIN)));
}
