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

  it("would round wrong on float: a case that only Decimal gets exact", () => {
    // A NAIV lebegőpontos szorzás itt kerekítési hibát ad (mérve: a JS
    // `1.005 * 100 * 1` eredménye "100.49999999999999", nem "100.5"). A
    // Decimal-alapú számoló ugyanerre a bemenetre a PONTOS értéket adja --
    // ez a lap az, amit az ügyfél alá is ír, tehát a kerekítési hiba itt nem
    // "elhanyagolható eltérés", hanem egy rossz szám a szerződéses papíron.
    const naivFloatEredmeny = (1.005 * 100 * 1).toString();
    assert.equal(naivFloatEredmeny, "100.49999999999999");

    const amounts = computeMaintenanceOrderFormItemAmounts({
      unitPricePerOccasion: "1.005",
      quantity: 100,
      occasionsPerYear: 1,
      vatRatePercent: 27,
    });
    assert.equal(amounts.netAmount.toString(), "100.5");
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
