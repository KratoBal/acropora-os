import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptCodeMatch,
  codeLookupKeys,
  packSizes,
  type CodeCandidate,
} from "./supplier-code-match.js";

const variant = (
  variantId: string,
  sku: string,
  name: string,
): CodeCandidate => ({ variantId, sku, manufacturerPartNumber: null, name });

describe("codeLookupKeys", () => {
  it("looks up the code, and its tail only when the tail has a letter", () => {
    assert.deepEqual(codeLookupKeys("ARKA-MB1900"), ["ARKA-MB1900", "MB1900"]);
    // measured: BLUELIFE-355 "Phos FX" -> our 355 is a cleaner wrasse
    assert.deepEqual(codeLookupKeys("BLUELIFE-355"), ["BLUELIFE-355"]);
    assert.deepEqual(codeLookupKeys("SOW20"), ["SOW20"]);
    assert.deepEqual(codeLookupKeys("  "), []);
  });
});

describe("packSizes", () => {
  it("reads litres, millilitres, grams and kilograms as one unit each", () => {
    assert.deepEqual([...packSizes("NO3:PO4-X 1 litre")], ["1000ml"]);
    assert.deepEqual([...packSizes("REDSEA NO3:PO4-X 1000ML")], ["1000ml"]);
    assert.deepEqual([...packSizes("Reef Fuel - 0,5 ltr")], ["500ml"]);
    assert.deepEqual([...packSizes("Balling Mg - 2 kg")], ["2000g"]);
    assert.deepEqual([...packSizes("Prime HD Led Puck")], []);
  });
});

describe("acceptCodeMatch", () => {
  it("takes the one product the code names", () => {
    const lens = variant(
      "v1",
      "AI-LENS16",
      "Aqua Illumination gyűjtőlencse 1db",
    );
    assert.equal(acceptCodeMatch("Lens for Hydra 32 HD", [lens]), lens);
  });

  it("refuses a code match whose pack size contradicts the line", () => {
    // measured: XEPTA-1002 "1000ml" sits on our 500ml variant
    assert.equal(
      acceptCodeMatch("XEPTA NP-out - 1000ml", [
        variant("v1", "XEPTA-1002", "Xepta NP-Out! 500ml"),
      ]),
      null,
    );
    // the same size written another way is no contradiction
    const liter = variant("v2", "OA-RF1", "Ocean Art Reef Fuel - 1 liter");
    assert.equal(acceptCodeMatch("Reef Fuel - 1000 ml", [liter]), liter);
  });

  it("never takes a clearance or short-dated product", () => {
    assert.equal(
      acceptCodeMatch("Energy - 50ml", [
        variant(
          "v1",
          "AFO-731119",
          "Aquaforest Energy 50ml - KÖZELI LEJÁRATÚ TERMÉK",
        ),
      ]),
      null,
    );
  });

  it("gives no answer when the code names two products", () => {
    assert.equal(
      acceptCodeMatch("Pump", [
        variant("v1", "X-1", "Pump A"),
        variant("v2", "X-1", "Pump B"),
      ]),
      null,
    );
  });
});
