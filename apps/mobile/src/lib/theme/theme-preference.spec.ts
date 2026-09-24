import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveColorScheme } from "./theme-preference";

describe("resolveColorScheme", () => {
  it("explicit light/dark választás felülír mindent", () => {
    assert.equal(
      resolveColorScheme({ preference: "light", system: "dark" }),
      "light",
    );
    assert.equal(
      resolveColorScheme({ preference: "dark", system: "light" }),
      "dark",
    );
  });

  it("'system' választásnál a rendszer állása dönt", () => {
    assert.equal(
      resolveColorScheme({ preference: "system", system: "light" }),
      "light",
    );
    assert.equal(
      resolveColorScheme({ preference: "system", system: "dark" }),
      "dark",
    );
  });

  it("még el nem mentett választásnál (null) is a rendszer dönt", () => {
    assert.equal(
      resolveColorScheme({ preference: null, system: "light" }),
      "light",
    );
  });

  /**
   * KALIBRÁCIÓ: ha az alapértelmezés "light" lenne, ez az állítás "light"-ot
   * adna -- pont azt az esetet fedi, amikor sem a mentett választás, sem a
   * rendszer nem tudható.
   */
  it("teljesen ismeretlen rendszer-állásnál a sötét az alapértelmezés", () => {
    assert.equal(
      resolveColorScheme({ preference: null, system: null }),
      "dark",
    );
    assert.equal(
      resolveColorScheme({ preference: "system", system: null }),
      "dark",
    );
  });
});
