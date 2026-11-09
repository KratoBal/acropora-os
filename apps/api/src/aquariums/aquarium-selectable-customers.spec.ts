import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectableCustomersWhere } from "./aquariums.repository.js";

/**
 * AZ AKVARIUM FELVITEL VEVO-VALASZTOJANAK SZURŐJE (2026-11-05, az arajanlat valaszto elo hibaja utan; 40332480). MI PIROSIT:
 * ha a szuro ujra kizarja a partner-kotest viselo sort (az egyesitett partner, peldaul egy allatkert, nem lenne
 * kivalaszthato az akvarium felvitelnel); ha az inaktiv ugyfel is ajanlhato; ha a nevkeresesbol kapott azonositok nem
 * szukitik a listat (az ekezet-fuggetlen egyezes a `unaccent`-es azonosito-lekerdezesen megy, nem itt); ha a Prisma
 * `contains` ujra visszakerul a nevre (az ekezetre nem erzeketlen); ha ures kereses is szur.
 */
describe("the aquarium customer picker's filter", () => {
  it("has no partner key: a partner-linked customer row is offered like any other", () => {
    for (const ids of [undefined, null, [], ["a"]])
      assert.equal("partner" in selectableCustomersWhere(ids), false);
  });

  it("offers active customers only", () => {
    assert.equal(selectableCustomersWhere().isActive, true);
    assert.equal(selectableCustomersWhere(["a"]).isActive, true);
  });

  it("narrows to the ids the name search found, and nothing else", () => {
    assert.deepEqual(selectableCustomersWhere(["a", "b"]).id, {
      in: ["a", "b"],
    });
    // a search that matched nobody is an empty list, not an unfiltered one
    assert.deepEqual(selectableCustomersWhere([]).id, { in: [] });
  });

  it("puts no name filter of its own on the list", () => {
    assert.equal("displayName" in selectableCustomersWhere(["a"]), false);
  });

  it("no search puts no id filter on the list", () => {
    assert.equal("id" in selectableCustomersWhere(), false);
    assert.equal("id" in selectableCustomersWhere(null), false);
  });
});
