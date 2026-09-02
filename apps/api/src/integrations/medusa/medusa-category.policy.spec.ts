import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideMedusaCategories,
  describeMissingCategoryMapping,
} from "./medusa-category.policy.js";

describe("a kategóriák leképezése a vetítésben", () => {
  it("teljes leképezésnél a Medusa-azonosítókat adja, a bemenet sorrendjében", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [
        { entityId: "cat_hal", externalId: "pcat_hal" },
        { entityId: "cat_korall", externalId: "pcat_korall" },
      ],
    );

    assert.equal(decision.kind, "complete");
    // A lekérdezés visszatérési sorrendje NEM garantált: a kimenet a bemenetet
    // követi, különben két futás két különböző kérés-törzset adna.
    assert.deepEqual(decision.medusaCategoryIds, ["pcat_korall", "pcat_hal"]);
    assert.deepEqual(decision.missing, []);
  });

  it("kategória nélküli terméknél nincs mit küldeni", () => {
    const decision = decideMedusaCategories([], []);

    assert.equal(decision.kind, "none");
    assert.equal(decision.medusaCategoryIds, null);
    assert.deepEqual(decision.missing, []);
  });

  /**
   * MINDEN VAGY SEMMI. Egyetlen hiányzó leképezés az EGÉSZ mezőt visszatartja:
   * a részleges lista -- ha a mező csere-szemantikájú -- letörölné a termékről
   * azokat a kategóriákat, amiket nem tudtunk megnevezni.
   */
  it("egyetlen hiányzó leképezés az egész mezőt visszatartja", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [{ entityId: "cat_korall", externalId: "pcat_korall" }],
    );

    assert.equal(decision.kind, "incomplete");
    assert.equal(decision.medusaCategoryIds, null);
    assert.deepEqual(decision.missing, ["cat_hal"]);
  });

  /**
   * EZ AZ AZ ÁLLÍTÁS, AMIÉRT A DÖNTÉS UNIÓ ÉS NEM EGY MEZŐ.
   *
   * A "nincs kategóriája" és a "van, de még nincs leképezve" a kérés törzsére
   * nézve UGYANAZ: egyik sem küld `categories` kulcsot. A következményük
   * viszont ellentétes -- az első rendben van, a második hiányt jelez --, és ha
   * a két állapot ugyanúgy nézne ki, később senki nem tudná megmondani,
   * melyik állt fenn.
   */
  it("a két üres eset a törzsre nézve azonos, a jelentésre nézve NEM", () => {
    const nincs = decideMedusaCategories([], []);
    const nincsLekepezve = decideMedusaCategories(["cat_hal"], []);

    // A törzs szempontjából megkülönböztethetetlen: ez a szándék.
    assert.equal(nincs.medusaCategoryIds, null);
    assert.equal(nincsLekepezve.medusaCategoryIds, null);

    // A jelentés szempontjából viszont NEM az.
    assert.notEqual(nincs.kind, nincsLekepezve.kind);
    assert.deepEqual(nincs.missing, []);
    assert.deepEqual(nincsLekepezve.missing, ["cat_hal"]);
  });

  /**
   * A HIÁNYT HALMAZ-LEFEDÉS DÖNTI EL, NEM A KÉT LISTA HOSSZA.
   *
   * Ez a bemenet pontosan azon a különbségen áll: két kategória, két
   * leképezés-sor -- de az egyik sor DUPLIKÁTUM, tehát az egyik kategória
   * lefedetlen. Hossz-összevetéssel ez "teljes" lenne, és részleges listát
   * küldenénk ki: pont azt a csendes törlést, amit ez a modul megelőz.
   *
   * A séma ma mindkét oldalon kizárja a duplikációt
   * (`ProductCategory @@unique([productId, categoryId])`,
   * `ExternalReference @@unique([system, entityType, entityId])`), tehát ez a
   * bemenet MA nem áll elő. Az állítás nem is a mai adatot méri, hanem azt,
   * hogy egy megszorítás elvesztése ne NÉMA hibává váljon.
   */
  it("duplikált leképezés-sor nem tesz teljessé egy hiányos lefedést", () => {
    const decision = decideMedusaCategories(
      ["cat_korall", "cat_hal"],
      [
        { entityId: "cat_korall", externalId: "pcat_korall" },
        { entityId: "cat_korall", externalId: "pcat_korall" },
      ],
    );

    assert.equal(decision.kind, "incomplete");
    assert.deepEqual(decision.missing, ["cat_hal"]);
  });

  it("ismétlődő bemeneti azonosító nem jelent hiányt", () => {
    const decision = decideMedusaCategories(
      ["cat_hal", "cat_hal"],
      [{ entityId: "cat_hal", externalId: "pcat_hal" }],
    );

    assert.equal(decision.kind, "complete");
    assert.deepEqual(decision.medusaCategoryIds, ["pcat_hal"]);
  });

  /**
   * A SOR AZ AZONOSÍTÓKAT NEVEZI MEG, nem csak a darabszámot: a leképezés
   * pótlása pontosan azokon múlik.
   */
  it("a hiány sora megnevezi, MELYIK kategória hiányzik", () => {
    const sor = describeMissingCategoryMapping("prod_1", [
      "cat_hal",
      "cat_rak",
    ]);

    assert.match(sor, /prod_1/);
    assert.match(sor, /2 kategória/);
    assert.match(sor, /cat_hal, cat_rak/);
    assert.match(sor, /EGYIKET SEM/);
  });
});
