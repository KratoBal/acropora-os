import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SZAMLAZZ_AMOUNT_RULE,
  szamlazzDocumentTotals,
  szamlazzLineAmounts,
  szamlazzMoneyDecimals,
  type SzamlazzAmountRule,
} from "./billing-szamlazz-amounts.js";

const line = (quantity: string, unitNet: string, currency = "HUF") => ({
  quantity,
  unitNet,
  vatRatePercent: "27",
  currency,
});

const TWO_EXACT: SzamlazzAmountRule = { hufDecimals: 2, exactNet: true };
const TWO_ROUNDED: SzamlazzAmountRule = { hufDecimals: 2, exactNet: false };
const WHOLE_ROUNDED: SzamlazzAmountRule = { hufDecimals: 0, exactNet: false };

// the five variants of the stage measurement (meres-kerekites.mjs), each
// under the rule it would confirm
describe("szamlazzLineAmounts", () => {
  it("A: whole forints stay whole", () => {
    assert.deepEqual(szamlazzLineAmounts(line("2", "1000"), TWO_EXACT), {
      ok: true,
      netAmount: "2000.00",
      vatAmount: "540.00",
      grossAmount: "2540.00",
    });
    assert.deepEqual(szamlazzLineAmounts(line("2", "1000"), WHOLE_ROUNDED), {
      ok: true,
      netAmount: "2000",
      vatAmount: "540",
      grossAmount: "2540",
    });
  });

  it("B: a two-decimal unit price, the VAT rounded half up", () => {
    // 3 × 1566.93 = 4700.79; × 27% = 1269.2133
    assert.deepEqual(szamlazzLineAmounts(line("3", "1566.93"), TWO_EXACT), {
      ok: true,
      netAmount: "4700.79",
      vatAmount: "1269.21",
      grossAmount: "5970.00",
    });
  });

  it("C: a fractional quantity with a whole price is exact", () => {
    assert.deepEqual(szamlazzLineAmounts(line("1.5", "1000"), TWO_EXACT), {
      ok: true,
      netAmount: "1500.00",
      vatAmount: "405.00",
      grossAmount: "1905.00",
    });
  });

  it("D: fraction × decimal price does not fit two decimals; an exact rule says so instead of rounding", () => {
    // 1.5 × 1566.93 = 2350.395
    assert.deepEqual(szamlazzLineAmounts(line("1.5", "1566.93"), TWO_EXACT), {
      ok: false,
      error: "NET_NOT_EXACT",
    });
    assert.deepEqual(szamlazzLineAmounts(line("1.5", "1566.93"), TWO_ROUNDED), {
      ok: true,
      netAmount: "2350.40",
      vatAmount: "634.61",
      grossAmount: "2985.01",
    });
  });

  it("E: under whole forints, the net and the VAT round to forints", () => {
    assert.deepEqual(
      szamlazzLineAmounts(line("1.5", "1566.93"), WHOLE_ROUNDED),
      { ok: true, netAmount: "2350", vatAmount: "635", grossAmount: "2985" },
    );
  });

  it("the gross is always net + VAT, the Agent's second identity", () => {
    for (const [quantity, unitNet] of [
      ["7", "12.34"],
      ["0.333", "999.99"],
      ["12", "0.01"],
    ] as const)
      for (const rule of [TWO_ROUNDED, WHOLE_ROUNDED]) {
        const amounts = szamlazzLineAmounts(line(quantity, unitNet), rule);
        assert.ok(amounts.ok);
        assert.equal(
          Math.round(
            (Number(amounts.netAmount) + Number(amounts.vatAmount)) * 100,
          ),
          Math.round(Number(amounts.grossAmount) * 100),
          `${quantity} × ${unitNet}`,
        );
      }
  });

  it("a discount line is negative, and rounds away from zero", () => {
    assert.deepEqual(szamlazzLineAmounts(line("1", "-200"), TWO_EXACT), {
      ok: true,
      netAmount: "-200.00",
      vatAmount: "-54.00",
      grossAmount: "-254.00",
    });
    // -0.05 × 27% = -0.0135 -> -0.01
    const small = szamlazzLineAmounts(line("1", "-0.05"), TWO_EXACT);
    assert.deepEqual(small, {
      ok: true,
      netAmount: "-0.05",
      vatAmount: "-0.01",
      grossAmount: "-0.06",
    });
  });

  it("keeps two decimals in another currency, whatever the forint rule", () => {
    assert.equal(szamlazzMoneyDecimals("EUR", WHOLE_ROUNDED), 2);
    assert.deepEqual(
      szamlazzLineAmounts(line("3", "9.99", "EUR"), WHOLE_ROUNDED),
      {
        ok: true,
        netAmount: "29.97",
        vatAmount: "8.09",
        grossAmount: "38.06",
      },
    );
  });

  it("refuses a number that is not a decimal, rather than reading it as zero", () => {
    assert.deepEqual(szamlazzLineAmounts(line("1,5", "1000")), {
      ok: false,
      error: "INVALID_NUMBER",
    });
  });

  it("holds the measured rule: two decimals, a tolerance on unit × quantity", () => {
    assert.deepEqual(SZAMLAZZ_AMOUNT_RULE, { hufDecimals: 2, exactNet: false });
    // D went through on the test account, so the default rule sends it
    assert.equal(szamlazzLineAmounts(line("1.5", "1566.93")).ok, true);
  });
});

// the Agent's own answers on the stage test account (acrobot 25153): the
// totals it returned for what each variant sent
describe("szamlazzDocumentTotals", () => {
  const totals = (lines: Array<[string, string]>, currency = "HUF") =>
    szamlazzDocumentTotals(
      lines.map(([netAmount, grossAmount]) => ({ netAmount, grossAmount })),
      currency,
    );

  it("rounds a forint document to whole forints, as Számlázz.hu answered", () => {
    for (const [sent, net, gross] of [
      [["2000", "2540"], "2000", "2540"], // A
      [["4700.79", "5970.00"], "4701", "5970"], // B
      [["1500", "1905"], "1500", "1905"], // C
      [["2350.40", "2985.01"], "2350", "2985"], // D
      [["2350", "2984.50"], "2350", "2985"], // E
    ] as const) {
      const result = totals([sent as unknown as [string, string]]);
      assert.deepEqual(
        [result.netAmount, result.grossAmount],
        [net, gross],
        sent.join(" / "),
      );
    }
  });

  it("makes the VAT the difference, so net + VAT = gross on the total", () => {
    assert.deepEqual(totals([["4700.79", "5970.00"]]), {
      netAmount: "4701",
      vatAmount: "1269",
      grossAmount: "5970",
    });
  });

  it("rounds the sum, not each line (not yet measured: two-line preview pending)", () => {
    // 0.40 + 0.40 = 0.80 -> 1; line by line it would be 0
    assert.deepEqual(
      totals([
        ["0.40", "0.51"],
        ["0.40", "0.51"],
      ]),
      {
        netAmount: "1",
        vatAmount: "0",
        grossAmount: "1",
      },
    );
  });

  it("subtracts a discount line before rounding", () => {
    assert.deepEqual(
      totals([
        ["2000.00", "2540.00"],
        ["-200.00", "-254.00"],
      ]),
      {
        netAmount: "1800",
        vatAmount: "486",
        grossAmount: "2286",
      },
    );
  });

  it("keeps two decimals in another currency", () => {
    assert.deepEqual(totals([["29.97", "38.06"]], "EUR"), {
      netAmount: "29.97",
      vatAmount: "8.09",
      grossAmount: "38.06",
    });
  });
});
