import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSeoLandingInput } from "./seo-landing.js";

/*
  THE LANDING PAGE INPUT (SEO P1-14). What turns these red: an empty filter
  accepted (the whole catalogue); an attribute filter accepted before the
  storefront can apply it; a missing title or publish flag accepted; a text
  over the commerce limit accepted (the projection would then be refused).
*/
const input = (over: Record<string, unknown> = {}) => ({
  slug: "led-vilagitas",
  title: "LED világítás",
  seoTitle: null,
  metaDescription: "Válogatás.",
  intro: "",
  filter: { storeCategoryIds: ["cat-1", "cat-1"], brandIds: [] },
  isPublished: false,
  ...over,
});

describe("parseSeoLandingInput", () => {
  it("LANDING-OK: a category alone is enough; duplicates and blanks normalised", () => {
    const r = parseSeoLandingInput(input());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.value.filter, {
      storeCategoryIds: ["cat-1"],
      brandIds: [],
      attributeFilters: [],
    });
    assert.equal(r.value.intro, null);
    assert.equal(
      parseSeoLandingInput(
        input({ filter: { storeCategoryIds: [], brandIds: ["b-1"] } }),
      ).ok,
      true,
    );
  });

  it("LANDING-EMPTY: an empty filter is refused", () => {
    const r = parseSeoLandingInput(
      input({ filter: { storeCategoryIds: [], brandIds: [] } }),
    );
    assert.deepEqual(r, {
      ok: false,
      message: "filter: at least one category or brand",
    });
  });

  it("LANDING-ATTR: an attribute filter is refused, not yet", () => {
    const r = parseSeoLandingInput(
      input({
        filter: {
          storeCategoryIds: ["cat-1"],
          brandIds: [],
          attributeFilters: [{ key: "flowRate", op: "gte", value: 3000 }],
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.message : "", /not yet/);
  });

  it("LANDING-SHAPE: no title, no flag, an over-long meta or a bad id list", () => {
    for (const bad of [
      input({ title: " " }),
      input({ isPublished: "yes" }),
      input({ metaDescription: "x".repeat(321) }),
      input({ filter: { storeCategoryIds: [""], brandIds: [] } }),
      input({ slug: 5 }),
    ])
      assert.equal(parseSeoLandingInput(bad).ok, false, JSON.stringify(bad));
  });
});
