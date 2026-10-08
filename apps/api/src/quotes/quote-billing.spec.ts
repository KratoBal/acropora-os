import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { allocateMilestone } from "./quote-billing.js";

const D = (n: number | string) => new Prisma.Decimal(n);
const line = (net: number | string, rate: number) => ({
  net: D(net),
  vatRatePercent: D(rate),
});
const sum = (lines: Array<{ net: string }>) =>
  lines.reduce((s, l) => s.plus(l.net), D(0)).toString();

describe("a milestone's proforma by VAT rate (#1582 P7)", () => {
  it("27% and 5% mixed: each rate its share, the remainder on the larger net", () => {
    // 40% of 100 001 is 40 000.4, of 33 333 is 13 333.2; the whole 53 333.6 rounds to 53 334
    const split = allocateMilestone(
      [line(60_001, 27), line(40_000, 27), line(33_333, 5)],
      D(40),
    );
    assert.deepEqual(
      [split.lines, split.total, sum(split.lines)],
      [
        [
          { vatRatePercent: "27", net: "40001" },
          { vatRatePercent: "5", net: "13333" },
        ],
        "53334",
        "53334",
      ],
      "BILL-27-5",
    );
  });

  it("the lines always add up to the rounded total", () => {
    const cases: Array<[Array<ReturnType<typeof line>>, number]> = [
      [[line("33333.33", 27), line("33333.33", 18), line("33333.34", 5)], 40],
      [[line(1, 27), line(1, 5)], 33.33],
      [[line("999.99", 27)], 20],
    ];
    assert.deepEqual(
      cases.map(([lines, p]) => {
        const split = allocateMilestone(lines, D(p));
        return sum(split.lines) === split.total;
      }),
      [true, true, true],
      "BILL-SUM",
    );
  });

  it("a rate with no net gives no line, and nothing gives nothing", () => {
    assert.deepEqual(
      [
        allocateMilestone([line(1000, 27), line(0, 5)], D(40)).lines.map(
          (l) => l.vatRatePercent,
        ),
        allocateMilestone([], D(40)).lines,
        // 40% of the 1 Ft at 5% rounds down to 0: no 0 Ft line
        allocateMilestone([line(1000, 27), line(1, 5)], D(40)).lines.map(
          (l) => l.vatRatePercent,
        ),
      ],
      [["27"], [], ["27"]],
      "BILL-EMPTY-RATE",
    );
  });
});
