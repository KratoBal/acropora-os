import { describe, expect, it } from "vitest";

import { businessNavigation } from "./navigation";

describe("navigation", () => {
  /**
   * The screen at /vevok holds webshop buyers, and the partners we work for
   * live under /partnerek. The menu is where that distinction is first made,
   * so it has to name them apart.
   *
   * Asserted here rather than only on the page, because the two are separate
   * strings in separate files: renaming the page heading and leaving the menu
   * saying "Vevők" is the half-finished state, and nothing else would report
   * it. The page's own heading is asserted in its own spec.
   */
  it("calls the webshop buyers what they are, apart from the partners", () => {
    const labels = new Map(
      businessNavigation.map((item) => [item.href, item.label]),
    );

    expect(labels.get("/vevok")).toBe("Webshop vásárló");
    expect(labels.get("/partnerek")).toBe("Partnerek");
  });
});
