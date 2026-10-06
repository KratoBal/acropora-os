/** The figure, four times its first 48 px (Balázs, 2026-10-06 08:08 UTC). */
export const FIGURE_SIZE = 192;
const GAP = 8;
const EDGE = 8;
/** Below this height the panel would be useless beside the figure; it covers it instead. */
const MIN_PANEL_HEIGHT = 200;
export interface FigurePosition {
  x: number;
  y: number;
}
export function clampPosition(
  position: FigurePosition,
  width: number,
  height: number,
): FigurePosition {
  return {
    x: Math.max(0, Math.min(position.x, Math.max(0, width - FIGURE_SIZE))),
    y: Math.max(0, Math.min(position.y, Math.max(0, height - FIGURE_SIZE))),
  };
}
export function storedPosition(userId: string): FigurePosition {
  try {
    const value = JSON.parse(
      localStorage.getItem(`sutyerak.position.${userId}`) ?? "null",
    );
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y))
      return clampPosition(value, window.innerWidth, window.innerHeight);
  } catch {
    /* Storage may be unavailable. */
  }
  return clampPosition(
    {
      x: window.innerWidth - FIGURE_SIZE - 24,
      y: window.innerHeight - FIGURE_SIZE - 24,
    },
    window.innerWidth,
    window.innerHeight,
  );
}
/**
 * The panel beside the figure, never over it: to its right, else to its left,
 * else above or below it (whichever has more room, the panel shortened to
 * fit). Only a window too small for any of these gets the panel over the
 * figure; it never leaves the window.
 */
export function panelPosition(
  position: FigurePosition,
  width: number,
  height: number,
) {
  const panelWidth = Math.min(380, Math.max(0, width - 2 * EDGE));
  const panelHeight = Math.min(560, Math.max(0, height - 2 * EDGE));
  const keepIn = (value: number, size: number, room: number) =>
    Math.max(EDGE, Math.min(value, room - size - EDGE));
  const right = position.x + FIGURE_SIZE + GAP;
  const left = position.x - GAP - panelWidth;
  if (right + panelWidth <= width - EDGE || left >= EDGE)
    return {
      left: right + panelWidth <= width - EDGE ? right : left,
      top: keepIn(position.y, panelHeight, height),
      width: panelWidth,
      height: panelHeight,
    };
  const above = position.y - GAP - EDGE;
  const below = height - (position.y + FIGURE_SIZE + GAP) - EDGE;
  const room = Math.max(above, below);
  if (room >= Math.min(MIN_PANEL_HEIGHT, panelHeight)) {
    const fitted = Math.min(panelHeight, room);
    return {
      left: keepIn(position.x, panelWidth, width),
      top:
        above >= below
          ? position.y - GAP - fitted
          : position.y + FIGURE_SIZE + GAP,
      width: panelWidth,
      height: fitted,
    };
  }
  return {
    left: keepIn(position.x, panelWidth, width),
    top: keepIn(position.y, panelHeight, height),
    width: panelWidth,
    height: panelHeight,
  };
}
