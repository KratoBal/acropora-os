// A DTO `@Type()` es `@Transform()` dekoratorokat hasznal (class-transformer),
// amik a `Reflect.getMetadata` fuggvenyt keresik. A sorrend szamit: ennek a
// sornak a DTO behuzasa ELOTT kell allnia, kulonben a fajl betoltesekor dob.
import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSET_LABEL_CODE_STORED_PATTERN } from "@acropora/types";

import { toStoredLabelCode } from "./dto/asset.dto.js";

/**
 * A MATRICAKOD-SZURO BEMENETENEK NORMALIZALASA.
 *
 * A kod a felulettol JON, nem a rendszerbol: valaki begepeli vagy egy leolvaso
 * adja. A ket forras nem ugyanazt a betumeretet adja, a TAROLT alak viszont
 * egyfele.
 */
describe("toStoredLabelCode", () => {
  it("a mar tarolhato alakot valtozatlanul adja", () => {
    assert.equal(toStoredLabelCode("V2196"), "V2196");
  });

  it("a kisbetus alakot felfele normalizalja", () => {
    assert.equal(toStoredLabelCode("v2196"), "V2196");
  });

  it("a korulotte allo szokozt levagja", () => {
    assert.equal(toStoredLabelCode("  v2196 "), "V2196");
  });

  /**
   * EZ A LEGFONTOSABB ESET, ES NEM SZORSZALHASOGATAS.
   *
   * A rossz alak VALTOZATLANUL megy tovabb, hogy a `@Matches` elutasitsa. Ha
   * `undefined` lenne belole, a szuro CSENDBEN eltunne a lekerdezesbol -- es a
   * valasz nem ures lista lenne, hanem a helyszin OSSZES eszkoze. Egy hivo,
   * aki a kodra egyetlen sort var, ilyenkor egy MASIK eszkozt adna hozza a
   * jegyhez, es semmi nem szolna.
   */
  it("a rossz alakot NEM dobja el, hanem tovabbengedi elutasitasra", () => {
    for (const rossz of ["V219", "VV2196", "2196V", "V-2196", "", "   "]) {
      const eredmeny = toStoredLabelCode(rossz);
      assert.equal(
        ASSET_LABEL_CODE_STORED_PATTERN.test(String(eredmeny)),
        false,
        `a(z) "${rossz}" nem valhat tarolhato alakka`,
      );
      assert.notEqual(
        eredmeny,
        undefined,
        `a(z) "${rossz}" nem tunhet el csendben`,
      );
    }
  });

  /**
   * A NEM SZOVEG BEMENET IS TOVABBMEGY, ugyanezert: egy ismetelt query
   * parameter (`?labelCode=a&labelCode=b`) tombkent erkezik, es azt a
   * validator utasitja el -- nem ez a fuggveny nyeli el.
   */
  it("a nem szoveg erteket valtozatlanul adja tovabb", () => {
    assert.deepEqual(toStoredLabelCode(["V2196", "V2197"]), ["V2196", "V2197"]);
    assert.equal(toStoredLabelCode(undefined), undefined);
    assert.equal(toStoredLabelCode(42), 42);
  });
});
