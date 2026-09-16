import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizePerformanceValue,
  performanceValueProblem,
} from "./unit-of-measure.js";

/**
 * A TELJESITMENY-ERTEK ALAKJA -- ES A ROSSZ ALAK NEM 400, HANEM 500 LENNE.
 *
 * A tarolt tipus `decimal(19,6)`. A `Prisma.Decimal` a beküldött szövegre DOB,
 * ha nem ismeri fel, es az a hiba a szolgaltatas `map` fuggvenyenek a vegeig
 * fut. Merve a valodi `Prisma.Decimal`-on, 2026-09-16: `"0,5"` dobott.
 *
 * EZ A FAJL AZERT VAN A KOZOS CSOMAGBAN, mert ugyanez a kerdes HAROM helyen
 * all: a szerveren, a weben es a telefonon. Harom minta ugyanarra pontosan ott
 * csuszna el, ahol senki nem nezi.
 */
describe("a teljesítmény-érték alakja", () => {
  /** EZ AZ AZ ALLITAS, AMIERT A FUGGVENY LETEZIK: a felulet magyar. */
  it("a tizedesvesszőt átveszi, nem utasítja el", () => {
    assert.equal(normalizePerformanceValue("0,5"), "0.5");
    assert.equal(performanceValueProblem("0,5"), null);
  });

  it("a pontot is átveszi", () => {
    assert.equal(normalizePerformanceValue("0.5"), "0.5");
  });

  it("a körülötte álló szóköz nem hiba", () => {
    // MERVE: a `Prisma.Decimal` a `"  7 "` alakra DOBOTT, tehat ez nem
    // kenyelmi trimmeles -- enelkul egy szokoz 500-at adna.
    assert.equal(normalizePerformanceValue("  7 "), "7");
  });

  it("az egész szám marad, ahogy van", () => {
    assert.equal(normalizePerformanceValue("500"), "500");
  });

  /**
   * A VEZETO NULLA ESIK, A TIZEDES NEM.
   *
   * A masodik allitas a testver-kontroll: az elso onmagaban akkor is zold
   * lenne, ha a fuggveny MINDEN nullat levagna a vegerol is -- es akkor a
   * kiirt pontossagot vennenk el a merestol.
   */
  it("a vezető nullákat levágja", () => {
    assert.equal(normalizePerformanceValue("007"), "7");
  });

  it("a tizedesjegyeket viszont MEGTARTJA", () => {
    assert.equal(normalizePerformanceValue("7.50"), "7.50");
  });

  it("az üres szöveg nem érték", () => {
    assert.equal(normalizePerformanceValue(""), null);
    assert.equal(performanceValueProblem(""), "empty");
    assert.equal(performanceValueProblem("   "), "empty");
  });

  /**
   * AMI ELBUKIK -- ES MINDEGYIK MAS OKBOL.
   *
   * A `-3` es az `1e3` a `Prisma.Decimal`-on ATMENNE (merve), tehat oket nem
   * a tarolas utasitja el, hanem MI: egy negativ teljesitmeny nem adat, es az
   * exponencialis alakot senki nem gepeli be.
   */
  it("a hibás alakok elbuknak, és a két kérdés külön áll", () => {
    for (const rossz of ["abc", "-3", "1e3", "1.2.3", "5 W", "1,5,5"]) {
      assert.equal(normalizePerformanceValue(rossz), null, rossz);
      assert.equal(performanceValueProblem(rossz), "malformed", rossz);
    }
  });

  it("hat tizedesjegy még átmegy, hét már nem", () => {
    assert.equal(normalizePerformanceValue("1.123456"), "1.123456");
    assert.equal(normalizePerformanceValue("1.1234567"), null);
  });
});
