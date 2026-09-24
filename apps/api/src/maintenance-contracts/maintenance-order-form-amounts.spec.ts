import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeMaintenanceOrderFormItemAmounts,
  sumMaintenanceOrderFormAmounts,
} from "./maintenance-order-form-amounts.js";

describe("maintenance order form amounts", () => {
  it("multiplies unit price by quantity AND occasions per year", () => {
    // A minta-lap "Cápasuli nagymedence" tétele: 475 000 Ft x 1 db x 4
    // alkalom = 1 900 000 Ft nettó (exchange/minta-megrendelolap-allatkert.docx).
    const amounts = computeMaintenanceOrderFormItemAmounts({
      unitPricePerOccasion: 475000,
      quantity: 1,
      occasionsPerYear: 4,
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "1900000");
    assert.equal(amounts.vatAmount.toString(), "513000");
    assert.equal(amounts.grossAmount.toString(), "2413000");
  });

  /**
   * KALIBRÁCIÓ: EGY BEMENET, AHOL A NATÍV LEBEGŐPONTOS SZORZÁS -- MÉG A 4
   * TIZEDESJEGYES KEREKÍTÉST IS TÚLÉLVE -- ROSSZ SZÁMOT ADNA.
   *
   * ELSŐRE `1.005 * 100 * 1`-et PRÓBÁLTAM ("100.49999999999999" lebegőponton),
   * ÉS AZ NEM VOLT VALÓDI KALIBRÁCIÓ (murena keresztellenőrzése vette észre,
   * 2026-09-24): a `MAINTENANCE_ORDER_FORM_MONEY_SCALE` itt 4, és
   * `(1.005*100*1).toFixed(4) === "100.5000"` -- UGYANAZ, amit a Decimal ad.
   * Egy ilyen bemenettel ez az állítás sosem különböztetné meg a Decimal-t
   * egy (hibás) `number`-alapú cserétől, mert a 4-tizedesjegyes kerekítés
   * épp elnyeli a lebegőpontos hibát, ami a 16-17. jegyen áll.
   *
   * A VALÓDI KALIBRÁCIÓ OTT VAN, AHOL A PONTOS SZORZAT ÉPP EGY KEREKÍTÉSI
   * HATÁRRA ESIK A 4. TIZEDESJEGYNÉL (X,XXXX5), és a lebegőpontos ábrázolás
   * EZEN a határon a rossz oldalra csúszik -- ugyanaz a technika, mint
   * murena `3 * 1.005`-e a #1045 2-tizedesjegyes skáláján, csak két
   * tizedesjeggyel arrébb. Mérve (node):
   *
   *   3 * 2.00005 === 6.00015              (a pontos szorzat is 6.00015)
   *   (3*2.00005).toFixed(4) === "6.0001"  (ROSSZ: a HALF_UP szabály 6.0002-t adna)
   *
   * A `console.log(3*2.00005)` "6.00015"-öt ír ki (a JS a legrövidebb
   * kerekre-kerekíthető tizedes alakot mutatja), de a TÁROLT dupla valójában
   * kicsivel KEVESEBB ennél -- a `toFixed()` a valódi bitmintát nézi, nem a
   * kiírt alakot, és ezért kerekít lefelé.
   *
   * A `Prisma.Decimal`-lal számolt nettó pontosan `"6.0002"` -- ha valaha
   * valaki ezt a függvényt `number`-alapúra cserélné, ez az állítás azonnal
   * pirosra váltana. VISSZAMÉRVE: ideiglenesen number-alapúra írtam a
   * `computeMaintenanceOrderFormItemAmounts`-ot, ez az egy állítás pirosra
   * váltott (`"6.0001"` jött ki `"6.0002"` helyett), utána visszaállítottam.
   */
  it("Decimal-lal pontos egy kerekítési határon, ahol a natív number-szorzás nem az", () => {
    assert.equal(
      (3 * 2.00005).toFixed(4),
      "6.0001",
      "ha ez az állítás elbukik, a kalibrációs bemenet elavult: keress egy másikat",
    );

    const amounts = computeMaintenanceOrderFormItemAmounts({
      unitPricePerOccasion: "2.00005",
      quantity: 3,
      occasionsPerYear: 1,
      vatRatePercent: 27,
    });
    assert.equal(
      amounts.netAmount.toString(),
      "6.0002",
      "a natív lebegőpontos szorzás 6.0001-et adna, nem 6.0002-t",
    );
  });

  it("derives VAT from the rounded net amount, so the printed numbers add up", () => {
    const amounts = computeMaintenanceOrderFormItemAmounts({
      unitPricePerOccasion: "1000.00005",
      quantity: 1,
      occasionsPerYear: 1,
      vatRatePercent: 27,
    });
    assert.equal(
      amounts.netAmount.plus(amounts.vatAmount).toString(),
      amounts.grossAmount.toString(),
    );
  });

  it("totals the four line items from the reference order form to the printed sum", () => {
    // A minta-lap négy sora és a "KARBANTARTÁSI DÍJAK ÖSSZESEN" 5 750 000 Ft.
    const lines = [
      { unitPricePerOccasion: 410000, quantity: 1, occasionsPerYear: 1 },
      { unitPricePerOccasion: 475000, quantity: 1, occasionsPerYear: 4 },
      { unitPricePerOccasion: 450000, quantity: 1, occasionsPerYear: 4 },
      { unitPricePerOccasion: 410000, quantity: 1, occasionsPerYear: 4 },
    ].map((item) =>
      computeMaintenanceOrderFormItemAmounts({ ...item, vatRatePercent: 27 }),
    );
    const total = sumMaintenanceOrderFormAmounts(lines);
    assert.equal(total.netAmount.toString(), "5750000");
    assert.equal(total.vatAmount.toString(), "1552500");
    assert.equal(total.grossAmount.toString(), "7302500");
  });

  it("sums an empty item list to zero", () => {
    const total = sumMaintenanceOrderFormAmounts([]);
    assert.equal(total.netAmount.toString(), "0");
    assert.equal(total.vatAmount.toString(), "0");
    assert.equal(total.grossAmount.toString(), "0");
  });
});
