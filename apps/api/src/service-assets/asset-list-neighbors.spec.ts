import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetListNeighbors } from "./asset-list-neighbors.js";

/**
 * AZ ADATLAP ELOZO/KOVETKEZO GOMBJA (Balazs kerese, 2026-09-30): a lista
 * sorrendjeben az eszkoz ket szomszedja, a lista vegen tiltott gombbal.
 * A sorrendet az adatbazis adja (a lista sajat `orderBy`-a); ez a spec azt
 * meri, hogy a hely megkeresese es a ket szel helyes.
 */
describe("assetListNeighbors", () => {
  const ids = ["a", "b", "c", "d"];

  it("a kozepen mindket szomszedot adja, a lista sorrendjeben", () => {
    assert.deepEqual(assetListNeighbors(ids, "c"), {
      previousId: "b",
      nextId: "d",
      position: 3,
      total: 4,
    });
  });

  it("az elso eszkoznel nincs elozo, az utolsonal nincs kovetkezo", () => {
    assert.equal(assetListNeighbors(ids, "a").previousId, null);
    assert.equal(assetListNeighbors(ids, "a").nextId, "b");
    assert.equal(assetListNeighbors(ids, "d").nextId, null);
    assert.equal(assetListNeighbors(ids, "d").previousId, "c");
  });

  it("egyelemu listaban mindket gomb tiltott", () => {
    assert.deepEqual(assetListNeighbors(["a"], "a"), {
      previousId: null,
      nextId: null,
      position: 1,
      total: 1,
    });
  });

  it("ha az eszkoz nincs a szurt listaban, nem talal ki szomszedot", () => {
    assert.deepEqual(assetListNeighbors(ids, "x"), {
      previousId: null,
      nextId: null,
      position: null,
      total: 4,
    });
  });
});
