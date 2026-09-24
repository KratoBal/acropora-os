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
   * KEREKÍTVE IS -- ROSSZ CENTET ADNA.
   *
   * ELSŐRE EGY MÁSIK BEMENETET (6 x 45454.55) PRÓBÁLTAM, ÉS AZ NEM VOLT
   * VALÓDI KALIBRÁCIÓ: a `6 * 45454.55` valóban `272727.30000000005`
   * lebegőpontosan (nem `272727.3`), DE ez a maradék `toFixed(2)` után
   * ELTŰNIK -- a hiba túl kicsi ahhoz, hogy a 2 tizedesjegyes kerekítést
   * túlélje. Mérve: `(6*45454.55).toFixed(2) === "272727.30"`, ugyanaz, mint
   * a Decimal válasza. Egy ilyen bemenettel ez az állítás sosem különböztetné
   * meg a Decimal-t egy (hibás) `number`-alapú cserétől.
   *
   * A VALÓDI KALIBRÁCIÓ OTT VAN, AHOL A PONTOS SZORZAT ÉPP EGY KEREKÍTÉSI
   * HATÁRRA ESIK (X,XX5), és a lebegőpontos ábrázolás EZEN a határon a
   * rossz oldalra csúszik. Mérve (node):
   *   3 * 1.005 === 3.0149999999999997   (a pontos szorzat 3.015 lenne)
   *   (3*1.005).toFixed(2) === "3.01"    (ROSSZ: a HALF_UP szabály 3.02-t adna)
   * A `Prisma.Decimal`-lal számolt nettó pontosan `"3.02"` -- ha valaha
   * valaki ezt a függvényt `number`-alapúra cserélné, ez az állítás azonnal
   * pirosra váltana, mert a natív szorzás a ROSSZ oldalára esne a határnak.
   */
  it("Decimal-lal pontos egy kerekítési határon, ahol a natív number-szorzás nem az", () => {
    assert.equal(
      (3 * 1.005).toFixed(2),
      "3.01",
      "ha ez az állítás elbukik, a kalibrációs bemenet elavult: keress egy másikat",
    );
    const amounts = computeCertificateLineAmounts({
      quantity: 3,
      unitPrice: "1.005",
      vatRatePercent: 27,
    });
    assert.equal(
      amounts.netAmount.toString(),
      "3.02",
      "a natív lebegőpontos szorzás 3.01-et adna, nem 3.02-t",
    );
  });

  /**
   * AZ ÁFA A KEREKÍTETT NETTÓBÓL SZÁMOL, NEM A NYERS SZORZATBÓL -- ÉS EZ
   * MÉRVE VALÓBAN MÁST AD, NEM CSAK ELVBEN.
   *
   * A nyers nettó 10.495, kerekítve (ROUND_HALF_UP) 10.50. Innentől a két út
   * szétválik:
   *   a KEREKÍTETT nettóból:  10.50 * 1% = 0.105  -> kerekítve 0.11
   *   a NYERS szorzatból:     10.495 * 1% = 0.10495 -> kerekítve 0.10
   * A kettő KÜLÖNBÖZIK (0.11 ≠ 0.10), tehát ez a bemenet ténylegesen
   * megkülönbözteti a két utat -- nem csak azt méri, hogy VALAMI számot ad.
   * Enélkül a lapon kiírt három szám (nettó, ÁFA, bruttó) nem adná ki
   * egymást.
   */
  it("az ÁFA a KEREKÍTETT nettóból számol, nem a nyers szorzatból", () => {
    const amounts = computeCertificateLineAmounts({
      quantity: 1,
      unitPrice: "10.495",
      vatRatePercent: 1,
    });
    assert.equal(amounts.netAmount.toString(), "10.5");
    assert.equal(
      amounts.vatAmount.toString(),
      "0.11",
      "a nyers szorzatból (0.10495) 0.10 jönne ki, nem 0.11",
    );
  });
});

describe("sumCertificateAmounts", () => {
  it("a sorok kerekített összegeit adja, nem a nyers szorzatokét", () => {
    const lineA = computeCertificateLineAmounts({
      quantity: 3,
      unitPrice: 700000,
      vatRatePercent: 27,
    });
    const lineB = computeCertificateLineAmounts({
      quantity: 6,
      unitPrice: "45454.55",
      vatRatePercent: 27,
    });
    const total = sumCertificateAmounts([lineA, lineB]);
    assert.equal(total.netAmount.toString(), "2372727.3");
    assert.equal(total.vatAmount.toString(), "640636.37");
    assert.equal(total.grossAmount.toString(), "3013363.67");
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
