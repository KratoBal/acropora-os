import { describe, expect, it } from "vitest";

import { nearestScrollTop } from "./cart-scroll";

/**
 * The container is a 300px tall box at viewport y=100. Rows are given in
 * viewport coordinates, the way `getBoundingClientRect()` reports them.
 */
const container = { top: 100, height: 300 };

describe("nearestScrollTop", () => {
  it("does not move when the row is already fully visible", () => {
    expect(nearestScrollTop(container, 40, { top: 150, height: 100 })).toBe(40);
  });

  it("scrolls down just enough to show a row below the visible area", () => {
    // Row content-top = 500 - 100 + 0 = 400, bottom 520 -> scrollTop 220.
    expect(nearestScrollTop(container, 0, { top: 500, height: 120 })).toBe(220);
  });

  it("scrolls up to the row's top when it sits above the visible area", () => {
    // scrollTop 400, row 50px above the container top -> content-top 350.
    expect(nearestScrollTop(container, 400, { top: 50, height: 100 })).toBe(
      350,
    );
  });

  it("aligns a row taller than the container to its top edge", () => {
    expect(nearestScrollTop(container, 0, { top: 250, height: 400 })).toBe(150);
  });
});
