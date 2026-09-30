import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SimplePayReport } from "./simplepay-report.parser.js";
import {
  reportDateOf,
  summaryWarnings,
} from "./simplepay-settlement.service.js";

const report = (count: number, amount: number, commission: number) =>
  ({
    transactions: Array.from({ length: count }),
    currency: "HUF",
    amountTotal: amount,
    commissionTotal: commission,
    netTotal: amount - commission,
    warnings: [],
  }) as unknown as SimplePayReport;

// the body of the 2026-09-30 mail, shape kept
const BODY =
  "elfogadóhelyen 2026.09.21 - 2026.09.27 forgalmi időszakról készült kimutatást. Tranzakciók száma: 2 Tranzakciók végösszege: 46 170 HUF Tranzakciós jutalék: 1 197 HUF ";

describe("reportDateOf", () => {
  it("reads the day from SimplePay's file name, and nothing from another", () => {
    assert.equal(reportDateOf("report_20260930.csv"), "2026-09-30");
    assert.equal(reportDateOf("Simple_majus_2026.xlsx"), null);
  });
});

describe("summaryWarnings", () => {
  it("takes the period from the mail, and says nothing when the CSV agrees", () => {
    assert.deepEqual(summaryWarnings(report(2, 46170, 1197), BODY), {
      warnings: [],
      periodStart: "2026-09-21",
      periodEnd: "2026-09-27",
    });
  });

  it("names every figure the CSV disagrees with its own mail on", () => {
    const { warnings } = summaryWarnings(report(3, 50000, 1200), BODY);
    assert.equal(warnings.length, 3);
    assert.match(warnings[0]!, /2 tranzakciót ír, a fájlban 3/);
  });

  it("an upload by hand has no mail to compare with", () => {
    assert.deepEqual(summaryWarnings(report(1, 1, 1), null), {
      warnings: [],
      periodStart: null,
      periodEnd: null,
    });
  });
});
