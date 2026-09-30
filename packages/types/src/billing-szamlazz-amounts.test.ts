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

// THE AGENT'S OWN ANSWERS on the stage test account, 2026-09-30 (acrobot 25153,
// 25157, 25159, 25161): what each preview sent, and the net and gross totals
// Számlázz.hu answered. Every one of them must come out exactly.
const MEASURED: Array<{
  name: string;
  sent: Array<[net: string, vat: string, gross: string]>;
  net: string;
  gross: string;
}> = [
  { name: "A", sent: [["2000", "540", "2540"]], net: "2000", gross: "2540" },
  {
    name: "B",
    sent: [["4700.79", "1269.21", "5970.00"]],
    net: "4701",
    gross: "5970",
  },
  { name: "C", sent: [["1500", "405", "1905"]], net: "1500", gross: "1905" },
  {
    name: "D",
    sent: [["2350.40", "634.61", "2985.01"]],
    net: "2350",
    gross: "2985",
  },
  {
    name: "E",
    sent: [["2350", "634.5", "2984.50"]],
    net: "2350",
    gross: "2985",
  },
  {
    name: "F",
    sent: [
      ["0.40", "0.11", "0.51"],
      ["0.40", "0.11", "0.51"],
    ],
    net: "2",
    gross: "2",
  },
  {
    name: "G",
    sent: [
      ["2350.40", "634.61", "2985.01"],
      ["2350.40", "634.61", "2985.01"],
    ],
    net: "4700",
    gross: "5970",
  },
  { name: "H1", sent: [["0.20", "0.05", "0.25"]], net: "0", gross: "0" },
  { name: "H2", sent: [["0.60", "0.16", "0.76"]], net: "1", gross: "1" },
  { name: "H3", sent: [["1.40", "0.38", "1.78"]], net: "2", gross: "2" },
  { name: "H4", sent: [["0.50", "0.14", "0.64"]], net: "1", gross: "1" },
  {
    name: "H5",
    sent: [
      ["10", "2.7", "12.70"],
      ["-0.40", "-0.11", "-0.51"],
    ],
    net: "9",
    gross: "12",
  },
  { name: "I1", sent: [["5.75", "1.55", "7.30"]], net: "5", gross: "7" },
  { name: "I2", sent: [["20.12", "5.43", "25.55"]], net: "21", gross: "26" },
];

describe("szamlazzDocumentTotals", () => {
  const totals = (
    sent: ReadonlyArray<readonly [string, string, string]>,
    currency = "HUF",
  ) =>
    szamlazzDocumentTotals(
      sent.map(([netAmount, vatAmount, grossAmount]) => ({
        netAmount,
        vatAmount,
        grossAmount,
      })),
      currency,
    );

  it("gives every total Számlázz.hu answered on the test account", () => {
    for (const measured of MEASURED) {
      const result = totals(measured.sent);
      assert.deepEqual(
        [result.netAmount, result.grossAmount],
        [measured.net, measured.gross],
        measured.name,
      );
    }
  });

  it("makes net + VAT = gross on the total", () => {
    for (const measured of MEASURED) {
      const result = totals(measured.sent);
      assert.equal(
        Number(result.netAmount) + Number(result.vatAmount),
        Number(result.grossAmount),
        measured.name,
      );
    }
  });

  it("names a line that became 0 Ft, instead of letting it vanish", () => {
    assert.deepEqual(totals([["0.20", "0.05", "0.25"]]).zeroForintLines, [0]);
    assert.deepEqual(
      totals([
        ["10", "2.7", "12.70"],
        ["0.20", "0.05", "0.25"],
      ]).zeroForintLines,
      [1],
    );
    assert.deepEqual(totals([["0.60", "0.16", "0.76"]]).zeroForintLines, []);
    // a line that was 0 to begin with is not flagged
    assert.deepEqual(totals([["0", "0", "0"]]).zeroForintLines, []);
  });

  it("keeps two decimals, and no forint rounding, in another currency", () => {
    assert.deepEqual(totals([["29.97", "8.09", "38.06"]], "EUR"), {
      netAmount: "29.97",
      vatAmount: "8.09",
      grossAmount: "38.06",
      zeroForintLines: [],
    });
  });
});
