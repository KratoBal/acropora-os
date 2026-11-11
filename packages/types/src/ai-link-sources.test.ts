import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_LINK_SOURCE_LIMITS,
  checkAiLinkSource,
  normalizeAiLinkHost,
} from "./ai-link-sources.js";

/**
 * THE STORED LINK SOURCE RULE (card 9d060f5c). WHAT TURNS IT RED: a host is stored in another form than the AI
 * gate compares (upper case, IDN, a trailing dot), so an entry can never match; a pasted URL, a port, a path or an
 * IP is cleaned into some host instead of refused; our own domain is listed; a manufacturer document is stored
 * without a brand, or an authority with one.
 */
const manufacturer = {
  host: "redseafish.com",
  category: "MANUFACTURER_DOCUMENT",
  brand: "Red Sea",
  note: "gyártói adatlapok",
};

describe("normalizeAiLinkHost", () => {
  it("gives the host the gate compares: ASCII, lower case, no trailing dot", () => {
    for (const [raw, host] of [
      ["redseafish.com", "redseafish.com"],
      ["  RedSeaFish.COM. ", "redseafish.com"],
      ["ácropora-gyarto.hu", "xn--cropora-gyarto-ugb.hu"],
      ["docs.tropic-marin.com", "docs.tropic-marin.com"],
      ["gyarto.xn--p1ai", "gyarto.xn--p1ai"],
    ] as const)
      assert.equal(normalizeAiLinkHost(raw), host, raw);
  });

  it("refuses what is not a bare host instead of cleaning it", () => {
    for (const raw of [
      "",
      "https://redseafish.com",
      "redseafish.com/manual.pdf",
      "redseafish.com:443",
      "user@redseafish.com",
      "red sea.com",
      "redseafish",
      "203.0.113.5",
      "[2001:db8::1]",
      "-redsea.com",
      "redsea-.com",
      "redsea..com",
      "redsea.c0m",
    ])
      assert.equal(normalizeAiLinkHost(raw), null, raw);
  });
});

describe("checkAiLinkSource", () => {
  it("a manufacturer document with its brand passes, normalised and trimmed", () => {
    assert.deepEqual(
      checkAiLinkSource({
        ...manufacturer,
        host: " RedSeaFish.com ",
        brand: " Red Sea ",
      }),
      {
        ok: true,
        value: {
          host: "redseafish.com",
          category: "MANUFACTURER_DOCUMENT",
          brand: "Red Sea",
          note: "gyártói adatlapok",
        },
      },
    );
  });

  it("an authority with no brand and no note passes", () => {
    assert.deepEqual(
      checkAiLinkSource({
        host: "nebih.gov.hu",
        category: "AUTHORITY",
        brand: "",
        note: "  ",
      }),
      {
        ok: true,
        value: {
          host: "nebih.gov.hu",
          category: "AUTHORITY",
          brand: null,
          note: null,
        },
      },
    );
  });

  it("refuses our own domain: the gate lets it out without a list", () => {
    for (const host of ["acropora.hu", "shop.acropora.hu", "ACROPORA.HU."])
      assert.deepEqual(
        checkAiLinkSource({ ...manufacturer, host }),
        {
          ok: false,
          error:
            "A saját domain nem kell a listára: az AI mindig hivatkozhat rá.",
        },
        host,
      );
    // a name that only CONTAINS ours is not ours
    assert.equal(
      checkAiLinkSource({ ...manufacturer, host: "evil-acropora.hu" }).ok,
      true,
    );
  });

  it("binds the brand to the category", () => {
    for (const bad of [
      { brand: null },
      { brand: "   " },
      { category: "AUTHORITY" },
      { category: "OTHER" },
      { category: undefined },
      { brand: 12 },
      { brand: "x".repeat(AI_LINK_SOURCE_LIMITS.brand + 1) },
      { note: "x".repeat(AI_LINK_SOURCE_LIMITS.note + 1) },
      { note: ["a"] },
      { host: "https://redseafish.com/x" },
      { host: undefined },
    ])
      assert.equal(
        checkAiLinkSource({ ...manufacturer, ...bad }).ok,
        false,
        JSON.stringify(bad),
      );
    assert.equal(checkAiLinkSource(null).ok, false);
  });
});
