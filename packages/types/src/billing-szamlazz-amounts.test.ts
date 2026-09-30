import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SZAMLAZZ_AMOUNT_RULE,
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

  it("starts from the strictest rule until the measurement decides", () => {
    assert.deepEqual(SZAMLAZZ_AMOUNT_RULE, { hufDecimals: 2, exactNet: true });
  });
});
