import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACROPORA_COMPANY } from "./company.js";
import {
  WEBSHOP_LEGAL_BLOCK_IDS,
  WEBSHOP_LEGAL_PLACEHOLDER_MARK,
  WEBSHOP_LEGAL_VERSIONS,
  webshopLegalIsComplete,
  webshopLegalPart,
} from "./webshop-legal.js";
import { parseWebshopMailFacts } from "./webshop-mail.js";

/*
  THE LEGAL PART OF THE ORDER CONFIRMATION (P0 #2). What turns these red: a
  version the shop can name that the OS does not know (the two the checkout
  records); a known version without all four documents; an unknown version
  getting a guessed text instead of a refusal; a missing version getting a
  legal part; a placeholder passing for a finished text; the company's lines
  leaving out the seat, the e-mail or the marked gaps.
*/
describe("the legal versions", () => {
  it("both versions the checkout records are known, with the four documents in order", () => {
    for (const version of ["unas-shop-2026-09-29", "fogyasztobarat-JPNFMVH0"]) {
      const known = WEBSHOP_LEGAL_VERSIONS[version];
      assert.ok(known, version);
      assert.deepEqual(
        known.blocks.map((b) => b.id),
        [...WEBSHOP_LEGAL_BLOCK_IDS],
      );
    }
  });

  it("no version is complete today: every block is a marked placeholder", () => {
    for (const version of Object.keys(WEBSHOP_LEGAL_VERSIONS)) {
      assert.equal(webshopLegalIsComplete(version), false, version);
      assert.ok(
        WEBSHOP_LEGAL_VERSIONS[version]!.blocks.every((b) => b.placeholder),
      );
    }
    assert.equal(webshopLegalIsComplete("ismeretlen"), false);
  });
});

describe("webshopLegalPart", () => {
  it("a missing version is no legal part at all", () => {
    for (const version of [null, undefined, "", "   "])
      assert.equal(webshopLegalPart(version), null, String(version));
  });

  it("an unknown version is a refusal that names it, not a guessed text", () => {
    const part = webshopLegalPart("regi-bolt-2020");
    assert.ok(part && !part.ok);
    assert.match(part.reason, /regi-bolt-2020/);
    assert.match(part.reason, /nem küldhető el/);
  });

  it("a known version carries the four documents, the seller's data and the placeholder mark, in html and text", () => {
    const part = webshopLegalPart("unas-shop-2026-09-29");
    assert.ok(part && part.ok);
    for (const title of [
      "Általános szerződési feltételek",
      "Tájékoztató az elállási jogról",
      "Elállási nyilatkozat (minta)",
      "Adatkezelési tájékoztató",
      "Az eladó adatai",
    ]) {
      assert.match(
        part.html,
        new RegExp(title.replace(/[()]/g, "\\$&")),
        title,
      );
      assert.ok(part.text.toUpperCase().includes(title.toUpperCase()), title);
    }
    assert.ok(part.html.includes(ACROPORA_COMPANY.address));
    assert.ok(part.text.includes(ACROPORA_COMPANY.email));
    // the OS knows only the tax number's base and no registration number: both are marked gaps
    assert.match(part.text, /Adószám: \[HELYŐRZŐ\]/);
    assert.match(part.text, /Cégjegyzékszám: \[HELYŐRZŐ\]/);
    assert.ok(part.html.includes(WEBSHOP_LEGAL_PLACEHOLDER_MARK));
  });

  it("the version is trimmed, and the label is escaped into the html", () => {
    const part = webshopLegalPart("  fogyasztobarat-JPNFMVH0  ");
    assert.ok(part && part.ok);
    assert.doesNotMatch(part.html, /<script/);
  });
});

describe("the facts carry the version", () => {
  const order = {
    display_id: 45,
    items: [],
    shipping: [],
    total: 1000,
    payment: "COD",
    pickup: false,
  };

  it("legal_version is read when sent, null when absent", () => {
    const sent = parseWebshopMailFacts("order-placed", {
      orders: [order],
      legal_version: "unas-shop-2026-09-29",
    });
    assert.ok(sent.ok && sent.facts.template === "order-placed");
    if (sent.ok && sent.facts.template === "order-placed")
      assert.equal(sent.facts.legal_version, "unas-shop-2026-09-29");

    const absent = parseWebshopMailFacts("order-placed", { orders: [order] });
    assert.ok(absent.ok && absent.facts.template === "order-placed");
    if (absent.ok && absent.facts.template === "order-placed")
      assert.equal(absent.facts.legal_version, null);
  });

  it("a legal_version that is not a string is a bad request", () => {
    const bad = parseWebshopMailFacts("order-placed", {
      orders: [order],
      legal_version: 7,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /legal_version/);
  });
});
