import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripLostEmoji } from "./description-lost-emoji.js";

/*
  AZ ELVESZETT HANGULATJEL (kartya 7d63e55c). MI PIROSIT: ha a "<h3>???? Ajanlott adagolas</h3>" fejlec negy kerdojellel marad; ha a
  kivetel szo kozepen, ot kerdojeles futason vagy egy ertelmes "?" jelen is ervenyesulne (a vevo "Miert ??" mondata megcsonkulna); ha a
  kivetel a kovetkezo szokozt is elvinne ketszer, vagy a tag-jel elott hagyna szokozt; ha a megmaradt negyes futast senki nem szamolna;
  ha a null szovegbol szoveg lenne.
  A PELDAK A VALODI ADATBOL VALOK (teszt Medusa 2026-11-13, a 9 erintett termek leirasa).
*/
describe("stripLostEmoji", () => {
  it("takes the run out of a heading and a paragraph start, with the space after it", () => {
    assert.deepEqual(stripLostEmoji("<h3>???? Ajánlott adagolás</h3>"), {
      text: "<h3>Ajánlott adagolás</h3>",
      removed: 1,
      remaining: 0,
    });
    assert.equal(
      stripLostEmoji("<p>???? <strong>Erős N52 mágnes</strong></p>").text,
      "<p><strong>Erős N52 mágnes</strong></p>",
    );
    assert.equal(stripLostEmoji("???? Első sor").text, "Első sor");
  });

  it("counts every run it takes out", () => {
    const two = stripLostEmoji("<h3>???? Egy</h3><h3>???? Kettő</h3>");
    assert.equal(two.text, "<h3>Egy</h3><h3>Kettő</h3>");
    assert.equal(two.removed, 2);
  });

  it("leaves everything else alone, and counts the exactly-four runs it left", () => {
    // not at a word start, no space after, five question marks, a real question
    const cases: [string, number][] = [
      ["Mi????ez", 1],
      ["<h3>????</h3>", 1],
      ["Miért ????", 1],
      ["Miért ????? így", 0],
      ["Tényleg ?", 0],
      ["Mi??? lesz??", 0],
    ];
    for (const [text, remaining] of cases) {
      const result = stripLostEmoji(text);
      assert.equal(result.text, text, text);
      assert.equal(result.removed, 0, text);
      assert.equal(result.remaining, remaining, text);
    }
  });

  it("null stays null", () => {
    assert.deepEqual(stripLostEmoji(null), {
      text: null,
      removed: 0,
      remaining: 0,
    });
  });
});
