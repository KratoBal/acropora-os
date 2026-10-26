import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTICLE_LIMITS, parseArticleBodyInput } from "./article.js";

/*
  THE ARTICLE BODY INPUT. What turns these red: an unknown field accepted (a
  typo would be stored silently); a slug that is not a URL part; no channel, an
  unknown or a doubled one; a non-https image (http leaks mixed content,
  javascript: runs); a doubled product or taxon link; a limit not held.
*/
const valid = (over: Record<string, unknown> = {}) => ({
  slug: "zold-acropora-tartasa",
  excerpt: "Rövid bevezető.",
  bodyHtml: "<p>Szöveg</p>",
  coverImageUrl: "https://static.acropora.hu/a.jpg",
  coverImageAlt: "Zöld Acropora",
  channels: ["WEBSHOP_BLOG", "REEFCLUB"],
  byline: "Acropora csapat",
  seoTitle: null,
  metaDescription: "",
  ogImageUrl: null,
  noindex: false,
  productIds: ["clx0abc123", "clx0abc124"],
  taxonKeys: ["ACROPORA", "ACROPORA_MILLEPORA"],
  ...over,
});

describe("parseArticleBodyInput", () => {
  it("takes a full article; an empty optional text is stored as null", () => {
    const parsed = parseArticleBodyInput(valid());
    assert.ok(parsed.ok);
    assert.equal(parsed.value.metaDescription, null);
    assert.equal(parsed.value.seoTitle, null);
    assert.deepEqual(parsed.value.channels, ["WEBSHOP_BLOG", "REEFCLUB"]);
  });

  it("refuses an unknown field, a bad slug, a bad channel list", () => {
    for (const bad of [
      valid({ extra: 1 }),
      valid({ slug: "Nagy Betű" }),
      valid({ slug: "a--b" }),
      valid({ slug: "-a" }),
      valid({ slug: "a".repeat(ARTICLE_LIMITS.slug + 1) }),
      valid({ channels: [] }),
      valid({ channels: ["INSTAGRAM"] }),
      valid({ channels: ["REEFCLUB", "REEFCLUB"] }),
      valid({ noindex: "nem" }),
      "cikk",
    ])
      assert.equal(parseArticleBodyInput(bad).ok, false, JSON.stringify(bad));
  });

  it("refuses an image that is not https", () => {
    for (const url of [
      "http://static.acropora.hu/a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/kep.png",
    ]) {
      assert.equal(
        parseArticleBodyInput(valid({ coverImageUrl: url })).ok,
        false,
        url,
      );
      assert.equal(
        parseArticleBodyInput(valid({ ogImageUrl: url })).ok,
        false,
        url,
      );
    }
  });

  it("refuses a doubled, malformed or too long product or taxon list", () => {
    for (const bad of [
      valid({ productIds: ["clx0abc123", "clx0abc123"] }),
      valid({ productIds: ["Nem Azonosító"] }),
      valid({
        productIds: Array.from(
          { length: ARTICLE_LIMITS.products + 1 },
          (_, i) => `p${i}`,
        ),
      }),
      valid({ taxonKeys: ["acropora"] }),
      valid({ taxonKeys: ["ACROPORA", "ACROPORA"] }),
    ])
      assert.equal(parseArticleBodyInput(bad).ok, false, JSON.stringify(bad));
  });

  it("holds the text limits", () => {
    for (const [field, max] of [
      ["excerpt", ARTICLE_LIMITS.excerpt],
      ["byline", ARTICLE_LIMITS.byline],
      ["seoTitle", ARTICLE_LIMITS.seoTitle],
      ["metaDescription", ARTICLE_LIMITS.metaDescription],
    ] as const)
      assert.equal(
        parseArticleBodyInput(valid({ [field]: "x".repeat(max + 1) })).ok,
        false,
        field,
      );
  });
});
