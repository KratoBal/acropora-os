import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  MissingInvoiceMonth,
  MissingInvoiceMonthsResponse,
} from "@acropora/types";

import {
  MISSING_INVOICES_CACHE_MS,
  MissingInvoicesSummaryCache,
} from "./missing-invoices-summary.js";

const month = (
  key: string,
  over: Partial<MissingInvoiceMonth> = {},
): MissingInvoiceMonth => ({
  month: key,
  debitCount: 10,
  found: 5,
  originalMissing: 1,
  notMatched: 2,
  noInvoice: 1,
  noInvoiceNeeded: 3,
  missingAmountHuf: "12345",
  status: "INCOMPLETE",
  missingStatementAccounts: [],
  ...over,
});

const response = (
  months: MissingInvoiceMonth[],
): MissingInvoiceMonthsResponse => ({
  company: { name: "Kitalált Kft.", taxNumber: "00000000-0-00" },
  months,
});

describe("Hiányzó számlák: the cached summary", () => {
  it("shows the two newest months; 'missing' is what the page's Hiányzik tab counts", async () => {
    const cache = new MissingInvoicesSummaryCache(async () =>
      response([
        month("2026-09"),
        month("2026-08", { notMatched: 0 }),
        month("2026-07"),
      ]),
    );
    const data = await cache.summary();
    assert.deepEqual(
      data.months.map((m) => [m.month, m.missing]),
      [
        ["2026-09", 4],
        ["2026-08", 2],
      ],
    );
  });

  it("reuses the result for 5 minutes, then reloads", async () => {
    let time = 0;
    let loads = 0;
    const cache = new MissingInvoicesSummaryCache(
      async () => {
        loads += 1;
        return response([month("2026-09")]);
      },
      () => time,
    );
    await cache.summary();
    time = MISSING_INVOICES_CACHE_MS - 1;
    await cache.summary();
    assert.equal(loads, 1);
    time = MISSING_INVOICES_CACHE_MS + 1;
    await cache.summary();
    assert.equal(loads, 2);
  });

  it("concurrent loads share ONE run of the expensive check", async () => {
    let loads = 0;
    const cache = new MissingInvoicesSummaryCache(async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response([month("2026-09")]);
    });
    await Promise.all([cache.summary(), cache.summary(), cache.summary()]);
    assert.equal(loads, 1);
  });

  it("a failure is never cached: the next load tries again", async () => {
    let attempt = 0;
    const cache = new MissingInvoicesSummaryCache(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("synthetic failure");
      return response([month("2026-09")]);
    });
    await assert.rejects(cache.summary());
    assert.equal((await cache.summary()).months.length, 1);
  });
});
