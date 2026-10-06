import { describe, expect, it } from "vitest";
import { clampPosition, FIGURE_SIZE, panelPosition } from "./position";

const overlaps = (
  panel: { left: number; top: number; width: number; height: number },
  figure: { x: number; y: number },
) =>
  panel.left < figure.x + FIGURE_SIZE &&
  figure.x < panel.left + panel.width &&
  panel.top < figure.y + FIGURE_SIZE &&
  figure.y < panel.top + panel.height;

const inside = (
  panel: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) =>
  panel.left >= 0 &&
  panel.top >= 0 &&
  panel.left + panel.width <= width &&
  panel.top + panel.height <= height;

describe("the 192 px figure and its panel", () => {
  it("the figure is four times its first 48 px, and stays in the window", () => {
    expect(FIGURE_SIZE).toBe(192);
    expect(clampPosition({ x: 9000, y: 9000 }, 1280, 800)).toEqual({
      x: 1088,
      y: 608,
    });
    expect(clampPosition({ x: -50, y: -50 }, 1280, 800)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("on a desktop the panel sits beside the figure, never over it, in both corners", () => {
    for (const figure of [
      { x: 1064, y: 584 },
      { x: 24, y: 24 },
      { x: 600, y: 300 },
    ]) {
      const panel = panelPosition(figure, 1280, 800);
      expect(overlaps(panel, figure)).toBe(false);
      expect(inside(panel, 1280, 800)).toBe(true);
    }
  });

  it("on a phone the panel goes above or below the figure, shortened to fit", () => {
    for (const figure of [
      { x: 159, y: 451 },
      { x: 0, y: 0 },
      { x: 90, y: 230 },
    ]) {
      const panel = panelPosition(figure, 375, 667);
      expect(overlaps(panel, figure)).toBe(false);
      expect(inside(panel, 375, 667)).toBe(true);
      expect(panel.height).toBeGreaterThanOrEqual(200);
    }
  });

  it("a window too small for any side gets the panel over the figure, but never outside the window", () => {
    const figure = clampPosition({ x: 9000, y: 9000 }, 320, 380);
    const panel = panelPosition(figure, 320, 380);
    expect(inside(panel, 320, 380)).toBe(true);
  });
});
