import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectableCustomersWhere } from "./aquariums.repository.js";

/**
 * AZ AKVARIUM FELVITEL VEVO-VALASZTOJANAK SZURŐJE (2026-11-05, az arajanlat valaszto elo hibaja utan). MI PIROSIT: ha
 * a szuro ujra kizarja a partner-kotest viselo sort (az egyesitett partner, peldaul egy allatkert, nem lenne
 * kivalaszthato az akvarium felvitelnel); ha az inaktiv ugyfel is ajanlhato; ha a keresett nev kis- és nagybetu
 * erzekeny; ha ures kereses is szur a nevre.
 */
describe("the aquarium customer picker's filter", () => {
  it("has no partner key: a partner-linked customer row is offered like any other", () => {
    for (const search of [undefined, "", "Fővárosi"])
      assert.equal("partner" in selectableCustomersWhere(search), false);
  });

  it("offers active customers only", () => {
    assert.equal(selectableCustomersWhere().isActive, true);
    assert.equal(selectableCustomersWhere("x").isActive, true);
  });

  it("searches the name, whatever the case", () => {
    assert.deepEqual(selectableCustomersWhere("Fővárosi").displayName, {
      contains: "Fővárosi",
      mode: "insensitive",
    });
  });

  it("an empty search puts no name filter on the list", () => {
    assert.equal("displayName" in selectableCustomersWhere(""), false);
    assert.equal("displayName" in selectableCustomersWhere(), false);
  });
});
