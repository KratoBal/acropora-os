import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FAVORITE_LIMITS, isFavoriteHref } from "./favorite.js";

/*
  THE FAVOURITE'S SHAPE. What turns these red: a full address, a protocol-less
  `//host`, a query or a fragment accepted as a menu page (the favourite is a
  page of the menu, not an arbitrary link); the dashboard root refused; the
  length bound moving away from the column width.
*/
describe("isFavoriteHref", () => {
  it("accepts the menu's own paths, the root included", () => {
    for (const href of [
      "/",
      "/feladataim",
      "/szerviz/hibajegyek",
      "/admin/integrations/szamlazz/connection",
      "/penzugy/hianyzo-szamlak",
    ]) {
      assert.equal(isFavoriteHref(href), true, href);
    }
  });

  it("refuses anything that is not a plain internal path", () => {
    for (const href of [
      "",
      "feladataim",
      "//example.org",
      "https://example.org/x",
      "/x?y=1",
      "/x#y",
      "/x//y",
      "/x/",
      "/x y",
      "/x\ny",
      "/árajánlat",
      "/../x",
      "/x/./y",
      "/%2e%2e/x",
    ]) {
      assert.equal(isFavoriteHref(href), false, JSON.stringify(href));
    }
    assert.equal(isFavoriteHref(undefined), false);
    assert.equal(isFavoriteHref(42), false);
  });

  it("refuses a path over the stored width", () => {
    const longest = "/" + "a".repeat(FAVORITE_LIMITS.maxHrefLength - 1);
    assert.equal(isFavoriteHref(longest), true);
    assert.equal(isFavoriteHref(longest + "a"), false);
  });
});
