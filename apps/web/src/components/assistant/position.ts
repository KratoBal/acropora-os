export const FIGURE_SIZE = 48;
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
export function panelPosition(
  position: FigurePosition,
  width: number,
  height: number,
) {
  const panelWidth = Math.min(380, Math.max(0, width - 16));
  const panelHeight = Math.min(560, Math.max(0, height - 16));
  const left =
    position.x + FIGURE_SIZE + 8 + panelWidth <= width - 8
      ? position.x + FIGURE_SIZE + 8
      : position.x - panelWidth - 8;
  return {
    left: Math.max(8, Math.min(left, width - panelWidth - 8)),
    top: Math.max(8, Math.min(position.y, height - panelHeight - 8)),
    width: panelWidth,
    height: panelHeight,
  };
}
