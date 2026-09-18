import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_THUMBNAIL_VARIANT,
  DOCUMENT_VARIANT_PARAM,
} from "./document-variant.js";

/**
 * KET ERTEK, ES A TESZTJUK NEM A SAJAT KONSTANSBOL VESZI A VART ALAKOT.
 *
 * Egy `assert.equal(DOCUMENT_VARIANT_PARAM, DOCUMENT_VARIANT_PARAM)` alaku
 * allitas a forrast igazolna, nem a viselkedest -- ezert all itt kiirva a
 * VART szoveg. Aki atirja az erteket, ITT bukik el, es nem a felhasznalonal,
 * ahol a csempe csendben a teljes meretu fajlt toltene le.
 */
describe("a csatolmany-valtozat neve", () => {
  it("a keres-parameter neve `variant`", () => {
    assert.equal(DOCUMENT_VARIANT_PARAM, "variant");
  });

  it("a belyegkep erteke `thumbnail`", () => {
    assert.equal(DOCUMENT_THUMBNAIL_VARIANT, "thumbnail");
  });

  it("a ket ertek NEM azonos", () => {
    assert.notEqual(DOCUMENT_VARIANT_PARAM, DOCUMENT_THUMBNAIL_VARIANT);
  });
});
