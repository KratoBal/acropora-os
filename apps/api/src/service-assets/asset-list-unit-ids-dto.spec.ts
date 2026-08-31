// A DTO `@Type()` es `@Transform()` dekoratorokat hasznal (class-transformer),
// amik a `Reflect.getMetadata` fuggvenyt keresik. A sorrend szamit: ennek a
// sornak a DTO behuzasa ELOTT kell allnia, kulonben a fajl betoltesekor dob.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toIdList } from "./dto/asset.dto.js";

/**
 * A TÖBB-ALEGYSÉGES SZŰRŐ BEMENETÉNEK NORMALIZÁLÁSA.
 *
 * A query sztringben nincs tömb-típus: ugyanaz a szándék háromféle alakban
 * érkezhet, és a felület mindhármat természetesnek találja. Ez a függvény hozza
 * egy alakra, MIELŐTT a lekérdezés-építő bármit kezdene vele.
 */
describe("toIdList", () => {
  it("wraps a single value", () => {
    assert.deepEqual(toIdList("a"), ["a"]);
  });

  it("keeps a repeated parameter as it arrives", () => {
    assert.deepEqual(toIdList(["a", "b"]), ["a", "b"]);
  });

  it("splits a comma separated value", () => {
    assert.deepEqual(toIdList("a,b,c"), ["a", "b", "c"]);
  });

  it("trims, because a comma separated list is usually typed by a person", () => {
    assert.deepEqual(toIdList("a , b"), ["a", "b"]);
  });

  /**
   * EZ A LEGFONTOSABB ESET, ÉS NEM SZŐRSZÁLHASOGATÁS.
   *
   * Egy `?departmentIds=` alakú, üres paraméter azt jelenti, hogy a felület nem
   * választott alegységet. Ha ebből ÜRES TÖMB lenne, a lekérdezés-építő
   * `{ in: [] }` szűrőt kapna, és a válasz NULLA sor lenne -- vagyis a „nem
   * szűrünk" szándék némán „egyetlen sort sem adunk vissza" jelentésűvé válna.
   * Ezért `undefined`: az a hívó oldalon „nincs szűrő".
   */
  it("returns undefined for an empty value rather than an empty list", () => {
    assert.equal(toIdList(""), undefined);
    assert.equal(toIdList([]), undefined);
    assert.equal(toIdList(" , "), undefined);
    assert.equal(toIdList(undefined), undefined);
  });

  it("ignores values that are not strings", () => {
    assert.equal(toIdList(42), undefined);
    assert.deepEqual(toIdList(["a", 42]), ["a"]);
  });
});
