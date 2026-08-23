import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeSkipped,
  isUnasWritableField,
  partitionByUnasAuthority,
  UNAS_WRITABLE_PRODUCT_FIELDS,
} from "./unas-write-policy.js";

const unasProduct = (id: string) => ({
  id,
  origin: "UNAS",
  catalogAuthority: "UNAS",
});
const acroporaProduct = (id: string) => ({
  id,
  origin: "UNAS",
  catalogAuthority: "ACROPORA",
});
const localProduct = (id: string) => ({
  id,
  origin: "LOCAL",
  catalogAuthority: "ACROPORA",
});

describe("UNAS write policy", () => {
  it("a UNAS-tulajdonú termék továbbra is frissül", () => {
    const partition = partitionByUnasAuthority(
      ["p1", "p2"],
      [unasProduct("p1"), unasProduct("p2")],
    );

    assert.deepEqual(partition.writableIds, ["p1", "p2"]);
    assert.deepEqual(partition.skipped, []);
  });

  it("az Acropora-tulajdonú terméket a UNAS nem írhatja", () => {
    const partition = partitionByUnasAuthority(["p1"], [acroporaProduct("p1")]);

    assert.deepEqual(partition.writableIds, []);
    assert.deepEqual(partition.skipped, [
      { productId: "p1", reason: "acropora-authority" },
    ]);
  });

  /**
   * Ez az eset állította meg eddig az EGÉSZ szinkront. Egyetlen idegen sor a
   * listában, és a bolt aznap nem kapott árukészletet - miközben a többi
   * ezer termékkel semmi baj nem volt.
   */
  it("a vegyes köteg nem áll meg: a többi termék megy tovább", () => {
    const partition = partitionByUnasAuthority(
      ["p1", "p2", "p3"],
      [unasProduct("p1"), acroporaProduct("p2"), unasProduct("p3")],
    );

    assert.deepEqual(partition.writableIds, ["p1", "p3"]);
    assert.deepEqual(partition.skipped, [
      { productId: "p2", reason: "acropora-authority" },
    ]);
  });

  it("a helyi terméket és a hiányzó sort külön okkal hagyja ki", () => {
    const partition = partitionByUnasAuthority(
      ["p1", "p2"],
      [localProduct("p1")],
    );

    assert.deepEqual(partition.skipped, [
      { productId: "p1", reason: "not-unas-origin" },
      { productId: "p2", reason: "missing" },
    ]);
  });

  it("ugyanazt az azonosítót egyszer dolgozza fel", () => {
    const partition = partitionByUnasAuthority(
      ["p1", "p1"],
      [unasProduct("p1")],
    );

    assert.deepEqual(partition.writableIds, ["p1"]);
  });

  /**
   * Egy szám önmagában nem mondja meg, MELYIK termék maradt ki. A napló
   * sorába azonosító kell, különben a kihagyás ugyanolyan megfoghatatlan,
   * mintha csendben történt volna.
   */
  it("a napló sora megnevezi a termékeket, okonként", () => {
    const line = describeSkipped([
      { productId: "p1", reason: "acropora-authority" },
      { productId: "p2", reason: "acropora-authority" },
      { productId: "p3", reason: "missing" },
    ]);

    assert.match(line, /p1, p2/);
    assert.match(line, /p3/);
    assert.match(line, /Acropora a törzsadat gazdája/);
  });

  /**
   * A mezőlista LEÍRÁS és MÉRCE: ha a szinkron írás-halmaza bővül anélkül,
   * hogy ide felvennék, ez a lista hazudik arról, mit csinál a rendszer.
   */
  describe("a mezőszintű szabály kódban áll", () => {
    it("tartalmazza, amit a szinkron ma ír", () => {
      for (const field of [
        "name",
        "description",
        "mirrorState",
        "lastSyncedAt",
        "categoryId",
      ])
        assert.ok(isUnasWritableField(field), `${field} hiányzik a listából`);
    });

    /**
     * Az ár szándékosan nincs a listán: külön terület, és a ProductVariant
     * modellen ma egyetlen ár-mező sincs. Ha valaki ide venné fel, az nem
     * bővítés lenne, hanem egy hiányzó adatmodell megkerülése.
     */
    it("nem tartalmazza az árat és a helyi törzsadatot", () => {
      for (const field of ["price", "grossPrice", "brandId", "isActive"])
        assert.equal(
          isUnasWritableField(field),
          false,
          `${field} nem a UNAS-é`,
        );
    });

    it("nincs benne kétszer ugyanaz a mező", () => {
      assert.equal(
        new Set(UNAS_WRITABLE_PRODUCT_FIELDS).size,
        UNAS_WRITABLE_PRODUCT_FIELDS.length,
      );
    });
  });
});
