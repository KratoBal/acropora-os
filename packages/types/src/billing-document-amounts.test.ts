import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeBillingDocumentAmounts,
  type BillingLineInput,
} from "./billing-document-amounts.js";

/**
 * A SZÁMLÁZÁS ÖSSZEG-SZÁMÍTÁSA (brief 15. és 33. pont: sorösszeg, ÁFA,
 * kedvezmény, bizonylat-összeg). A felület és a szerver ugyanezt hívja, tehát
 * ami itt zöld, az mindkét oldalon ugyanazt az összeget adja.
 */
function line(overrides: Partial<BillingLineInput> = {}): BillingLineInput {
  return {
    quantity: "1",
    unitNet: "1000",
    vatRatePercent: "27",
    discountPercent: null,
    ...overrides,
  };
}

function amounts(inputs: BillingLineInput[]) {
  const result = computeBillingDocumentAmounts(inputs);
  assert.ok(result.ok, JSON.stringify(result));
  return result.amounts;
}

describe("computeBillingDocumentAmounts", () => {
  it("a Figma három tétele: sorösszegek és a bizonylat összege", () => {
    const result = amounts([
      line({ quantity: "1", unitNet: "280000" }),
      line({ quantity: "2", unitNet: "30000" }),
      line({ quantity: "100", unitNet: "420" }),
    ]);
    assert.deepEqual(
      result.lines.map((entry) => entry.grossAmount),
      ["355600.0000", "76200.0000", "53340.0000"],
    );
    assert.deepEqual(result.totals, {
      netAmount: "382000.0000",
      vatAmount: "103140.0000",
      grossAmount: "485140.0000",
    });
  });

  /*
    A LEBEGŐPONTOS HIBA ITT BUKNA: 0,1 × 3 number-ként 0,30000000000000004.
    MI PIROSÍT: ha a számítás number-re váltana.
  */
  it("tizedes mennyiségnél pontos, nem lebegőpontos", () => {
    const result = amounts([
      line({ quantity: "0.1", unitNet: "0.1", vatRatePercent: "0" }),
      line({ quantity: "0.2", unitNet: "0.1", vatRatePercent: "0" }),
    ]);
    assert.equal(result.totals.netAmount, "0.0300");
  });

  it("az ÁFA fél-felfelé kerekül a pénz-skálára, és a bruttó pontosan nettó plusz ÁFA", () => {
    // 0,0001 × 27% = 0,000027 -> 0,0000; 0,0001 × 50% = 0,00005 -> 0,0001 (pontos fél, felfelé)
    const [a, b] = amounts([
      line({ quantity: "1", unitNet: "0.0001", vatRatePercent: "27" }),
      line({ quantity: "1", unitNet: "0.0001", vatRatePercent: "50" }),
    ]).lines;
    assert.equal(a!.vatAmount, "0.0000");
    assert.equal(b!.vatAmount, "0.0001");
    assert.equal(b!.grossAmount, "0.0002");
  });

  it("a kedvezmény külön negatív sor, a tétel ÁFA-kulcsával", () => {
    const [item] = amounts([
      line({ quantity: "2", unitNet: "30000", discountPercent: "10" }),
    ]).lines;
    assert.equal(item!.netAmount, "60000.0000");
    assert.deepEqual(item!.discount, {
      discountPercent: "10.00",
      netAmount: "-6000.0000",
      vatAmount: "-1620.0000",
      grossAmount: "-7620.0000",
    });
  });

  it("a bizonylat-összeg és a kulcsonkénti bontás a kedvezménnyel együtt számol", () => {
    const result = amounts([
      line({ quantity: "1", unitNet: "10000", discountPercent: "50" }),
      line({ quantity: "1", unitNet: "1000", vatRatePercent: "5" }),
    ]);
    assert.deepEqual(result.totals, {
      netAmount: "6000.0000",
      vatAmount: "1400.0000",
      grossAmount: "7400.0000",
    });
    assert.deepEqual(
      result.byVatRate.map((rate) => [rate.vatRatePercent, rate.netAmount]),
      [
        ["5.00", "1000.0000"],
        ["27.00", "5000.0000"],
      ],
    );
  });

  it("nulla vagy üres kedvezménynél nincs kedvezmény-sor", () => {
    const result = amounts([
      line({ discountPercent: "0" }),
      line({ discountPercent: "" }),
    ]);
    assert.deepEqual(
      result.lines.map((entry) => entry.discount),
      [null, null],
    );
  });

  it("a vesszős tizedes is elfogadott", () => {
    assert.equal(
      amounts([line({ quantity: "1,5", vatRatePercent: "0" })]).totals
        .netAmount,
      "1500.0000",
    );
  });

  it("a hibás bemenetet megnevezi, nem számol vele tovább", () => {
    assert.deepEqual(
      computeBillingDocumentAmounts([line(), line({ unitNet: "sok" })]),
      {
        ok: false,
        error: "BILLING_AMOUNT_INVALID",
        lineIndex: 1,
        field: "unitNet",
      },
    );
    assert.deepEqual(
      computeBillingDocumentAmounts([line({ quantity: "1.1234567" })]),
      {
        ok: false,
        error: "BILLING_AMOUNT_TOO_PRECISE",
        lineIndex: 0,
        field: "quantity",
      },
    );
    assert.equal(
      computeBillingDocumentAmounts([line({ discountPercent: "101" })]).ok,
      false,
    );
  });

  it("üres tétellistánál nulla az összeg", () => {
    assert.deepEqual(amounts([]).totals, {
      netAmount: "0.0000",
      vatAmount: "0.0000",
      grossAmount: "0.0000",
    });
  });
});
