import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateGtin } from "@acropora/jev/product-enrichment";

import {
  barcodeType,
  isProductGtin,
  storedBarcodeCode,
} from "./barcode-type.js";

/**
 * A TÍPUS-FELISMERÉS, KALIBRÁLVA (SEO P0 PR 4). Ugyanazok az esetek, mint a stage
 * szárazfutás eszközének öntesztjében (`agents/nautilus/scripts/pr4-vonalkod-
 * besorolas.mjs`). MI PIROSIT: egy ág rossz típust ad; a kiadvány (D3) vagy a
 * bolti tartomány GTIN-nek számít; a 13 jegyű UPC-A nem EAN13 (D4).
 */
describe("barcodeType", () => {
  // egy valódi UPC-A törzs, kiszámolt ellenőrző számjeggyel
  const upcTorzs = "65334119112";
  const upc = (() => {
    for (let d = 0; d <= 9; d++)
      if (validateGtin(upcTorzs + d).ok) return upcTorzs + d;
    throw new Error("nincs ervenyes UPC-A szamjegy");
  })();

  for (const [kod, tipus] of [
    ["4260507580214", "EAN13"],
    ["04260507580214", "GTIN14"],
    ["96385074", "EAN8"],
    ["4260507580215", "INTERNAL"], // hibás ellenőrző számjegy
    ["9780301379722", "INTERNAL"], // kiadvány-tartomány (D3)
    ["2000000000008", "INTERNAL"], // bolti tartomány
    ["ACR123", "INTERNAL"],
    ["12345", "INTERNAL"],
  ] as const)
    it(`${kod} -> ${tipus}`, () => assert.equal(barcodeType(kod), tipus));

  it("UPC-A 12 jegyen UPCA, 13 jegyen, vezető nullával EAN13 (D4)", () => {
    assert.equal(barcodeType(upc), "UPCA");
    assert.equal(barcodeType(`0${upc}`), "EAN13");
  });

  it("csak a nem-INTERNAL típus termék-GTIN", () => {
    assert.equal(isProductGtin("EAN13"), true);
    assert.equal(isProductGtin("INTERNAL"), false);
    assert.equal(isProductGtin(null), false);
  });
});

/*
  A JEV 14 JEGYES ALAKJABOL A CSOMAGOLAS ALAKJA (SEO P0 PR 4). MI PIROSIT: az
  EAN-13 14 jegyen marad (a cikkszam-kod 13 jegyen all, tehat ket sor lenne egy
  kodra); az EAN-8 13 jegyre bovul; egy valodi GTIN-14 elveszti a jelzojegyet.
*/
describe("storedBarcodeCode", () => {
  it("EAN-13 13 jegyen, EAN-8 8 jegyen, a valodi GTIN-14 14 jegyen; mas valtozatlan", () => {
    assert.equal(storedBarcodeCode("04260507580214"), "4260507580214");
    assert.equal(storedBarcodeCode("00000096385074"), "96385074");
    assert.equal(storedBarcodeCode("14260507580211"), "14260507580211");
    assert.equal(storedBarcodeCode("4260507580214"), "4260507580214");
    assert.equal(storedBarcodeCode("ACR1"), "ACR1");
  });
});
