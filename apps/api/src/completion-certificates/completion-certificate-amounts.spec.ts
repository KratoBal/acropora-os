import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  computeCertificateLineAmounts,
  sumCertificateAmounts,
} from "./completion-certificate-amounts.js";

describe("computeCertificateLineAmounts", () => {
  /**
   * A MINTA SZÁMA (ÁLT #2026-12): 3 alkalom x 700 000, 27% ÁFA.
   * Nettó 2 100 000, ÁFA 567 000, bruttó 2 667 000 -- betűre a mintáról.
   */
  it("a minta tételét pontosan a mintán látott három számra hozza", () => {
    const amounts = computeCertificateLineAmounts({
      quantity: 3,
      unitPrice: 700000,
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "2100000");
    assert.equal(amounts.vatAmount.toString(), "567000");
    assert.equal(amounts.grossAmount.toString(), "2667000");
  });

  /**
   * KALIBRÁCIÓ: EGY BEMENET, AHOL A NATÍV LEBEGŐPONTOS SZORZÁS -- MÉG
   * KEREKÍTVE IS -- ROSSZ SZÁMOT ADNA.
   *
   * A `CERTIFICATE_MONEY_SCALE` 2026-09-24-ÉN 2-RŐL 4-RE VÁLTOZOTT (a
   * `ContractItem.unitNet` séma-oszlopa, `Decimal(19,4)`, ehhez igazítva --
   * 679d4c04 kártya). A KORÁBBI kalibráció (`3 * 1.005`) ezzel ELAVULT: a
   * lebegőpontos hiba a 16-17. jegyen áll, a 4 tizedesjegyes kerekítés ezt
   * elnyeli -- `(3*1.005).toFixed(4) === "3.0150"`, ugyanaz, mint a Decimal
   * válasza. Ugyanaz a hiba, amit nautilus a saját megrendelőlap-moduljában
   * mért ugyanezen a napon (`maintenance-order-form-amounts.spec.ts`).
   *
   * AZ ÚJ, 4-TIZEDESJEGYES HATÁRRA ESŐ BEMENET, UGYANAZZAL A TECHNIKÁVAL.
   * Mérve (node):
   *   3 * 2.00005 === 6.00015              (a pontos szorzat is 6.00015)
   *   (3*2.00005).toFixed(4) === "6.0001"  (ROSSZ: a HALF_UP szabály 6.0002-t adna)
   * A `Prisma.Decimal`-lal számolt nettó pontosan `"6.0002"`.
   */
  it("Decimal-lal pontos egy kerekítési határon, ahol a natív number-szorzás nem az", () => {
    assert.equal(
      (3 * 2.00005).toFixed(4),
      "6.0001",
      "ha ez az állítás elbukik, a kalibrációs bemenet elavult: keress egy másikat",
    );
    const amounts = computeCertificateLineAmounts({
      quantity: 3,
      unitPrice: "2.00005",
      vatRatePercent: 27,
    });
    assert.equal(
      amounts.netAmount.toString(),
      "6.0002",
      "a natív lebegőpontos szorzás 6.0001-et adna, nem 6.0002-t",
    );
  });

  /**
   * AZ ÁFA A KEREKÍTETT NETTÓBÓL SZÁMOL, NEM A NYERS SZORZATBÓL -- ÉS EZ
   * MÉRVE VALÓBAN MÁST AD, NEM CSAK ELVBEN.
   *
   * A KORÁBBI BEMENET (10.495, 1% ÁFA) A 4 TIZEDESJEGYES SKÁLÁN MÁR NEM
   * KALIBRÁLT: "10.495" mindössze 3 tizedesjegyű, tehát 4 tizedesjegyre
   * kerekítve VÁLTOZATLAN marad -- a kerekített és a nyers nettó ugyanaz a
   * szám, tehát a belőlük számolt ÁFA is ugyanaz lenne.
   *
   * AZ ÚJ BEMENET (keresve, nem találgatva): a nyers nettó 10.00015,
   * kerekítve (ROUND_HALF_UP, 4 tizedesjegy) 10.0002. Innentől a két út
   * szétválik:
   *   a KEREKÍTETT nettóból:  10.0002 * 27% = 2.700054  -> kerekítve 2.7001
   *   a NYERS szorzatból:     10.00015 * 27% = 2.7000405 -> kerekítve 2.7000
   * A kettő KÜLÖNBÖZIK (2.7001 ≠ 2.7), tehát ez a bemenet ténylegesen
   * megkülönbözteti a két utat -- nem csak azt méri, hogy VALAMI számot ad.
   * Enélkül a lapon kiírt három szám (nettó, ÁFA, bruttó) nem adná ki
   * egymást.
   */
  it("az ÁFA a KEREKÍTETT nettóból számol, nem a nyers szorzatból", () => {
    const amounts = computeCertificateLineAmounts({
      quantity: 1,
      unitPrice: "10.00015",
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "10.0002");
    assert.equal(
      amounts.vatAmount.toString(),
      "2.7001",
      "a nyers szorzatból (2.7000405) 2.7 jönne ki, nem 2.7001",
    );
  });
});

describe("sumCertificateAmounts", () => {
  /**
   * A BEMENET ÚGY VAN VÁLASZTVA, HOGY A KÉT SORREND VALÓBAN MÁST ADJON.
   *
   * A KORÁBBI BEMENET (700 000 x 3 és 45454.55 x 6) A 4 TIZEDESJEGYES
   * SKÁLÁN MÁR NEM KALIBRÁLT: a `45454.55 * 6 = 272727.3` szorzat mindössze
   * 1 tizedesjegyű, tehát 4 tizedesjegyre kerekítve VÁLTOZATLAN marad -- a
   * "soronként kerekít" és a "csak a végén kerekít" út ugyanazt a számot
   * adta volna, tehát az állítás nem különböztette meg a két utat.
   *
   * AZ ÚJ BEMENET KÉT SORT VISZ, EGYENKÉNT A KEREKÍTÉSI HATÁR ALATT, DE
   * EGYÜTT A HATÁR FÖLÖTT: 1.00003 és 1.00004 külön-külön 4 tizedesjegyre
   * kerekítve "1.0000" (az 5. tizedesjegy 3, illetve 4, tehát lefelé
   * kerekül), de a NYERS összegük 2.00007, ami 4 tizedesjegyre kerekítve
   * "2.0001" (az 5. tizedesjegy 7, felfelé kerekül). A két út tehát
   * TÉNYLEGESEN eltér (2.0000 kontra 2.0001) -- ez a valódi kalibráció.
   */
  it("a sorok kerekített összegeit adja, nem a nyers szorzatokét", () => {
    const lineA = computeCertificateLineAmounts({
      quantity: 1,
      unitPrice: "1.00003",
      vatRatePercent: 0,
    });
    const lineB = computeCertificateLineAmounts({
      quantity: 1,
      unitPrice: "1.00004",
      vatRatePercent: 0,
    });
    assert.equal(lineA.netAmount.toString(), "1");
    assert.equal(lineB.netAmount.toString(), "1");
    const total = sumCertificateAmounts([lineA, lineB]);
    assert.equal(
      total.netAmount.toString(),
      "2",
      "a nyers összeg (2.00007) kerekítve 2.0001-et adna, nem 2-t",
    );
  });

  it("üres listára nulla mindhárom összeg", () => {
    const total = sumCertificateAmounts([]);
    assert.equal(total.netAmount.toString(), "0");
    assert.equal(total.vatAmount.toString(), "0");
    assert.equal(total.grossAmount.toString(), "0");
  });
});

describe("a Decimal bemenet alakja", () => {
  it("számot, sztringet és Decimal-t egyaránt elfogad", () => {
    const fromNumber = computeCertificateLineAmounts({
      quantity: 3,
      unitPrice: 700000,
      vatRatePercent: 27,
    });
    const fromString = computeCertificateLineAmounts({
      quantity: "3",
      unitPrice: "700000",
      vatRatePercent: "27",
    });
    const fromDecimal = computeCertificateLineAmounts({
      quantity: new Prisma.Decimal(3),
      unitPrice: new Prisma.Decimal(700000),
      vatRatePercent: new Prisma.Decimal(27),
    });
    for (const amounts of [fromNumber, fromString, fromDecimal]) {
      assert.equal(amounts.netAmount.toString(), "2100000");
    }
  });
});
