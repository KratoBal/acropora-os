import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import { EXTERNAL_KIND_TYPES } from "../billing/billing-document-list.js";
import {
  OVERDUE_COUNTED_KIND_CODES,
  OVERDUE_EXCLUDED_KIND_CODES,
  summarizeOverdueInvoices,
  type OverdueInvoiceRow,
} from "./overdue-invoices.js";

// 2026-10-02 10:00 UTC = 12:00 in Budapest; today is 2026-10-02
const now = new Date("2026-10-02T10:00:00Z");
const day = (key: string) => new Date(`${key}T00:00:00Z`);

const row = (over: Partial<OverdueInvoiceRow>): OverdueInvoiceRow => ({
  kindCode: "SZ",
  dueDate: day("2026-09-20"),
  grossAmount: new Prisma.Decimal("12700"),
  paidAmount: new Prisma.Decimal("0"),
  lastPaymentDate: null,
  paymentsKnown: true,
  paymentMethod: "Átutalás",
  paymentMethodUnified: null,
  currency: "HUF",
  cancelled: false,
  ...over,
});

describe("Lejáró számlák: the kinds", () => {
  it("decides every kind code of the billing module, one way or the other", () => {
    const decided = new Set([
      ...OVERDUE_COUNTED_KIND_CODES,
      ...OVERDUE_EXCLUDED_KIND_CODES,
    ]);
    assert.deepEqual(
      [...decided].sort(),
      Object.keys(EXTERNAL_KIND_TYPES).sort(),
      "a new kind code in billing must be decided here explicitly",
    );
    assert.equal(
      OVERDUE_COUNTED_KIND_CODES.filter((c) =>
        OVERDUE_EXCLUDED_KIND_CODES.includes(c),
      ).length,
      0,
    );
  });

  it("counts invoices and proformas, never delivery notes (owner decision)", () => {
    assert.ok(OVERDUE_COUNTED_KIND_CODES.includes("D"));
    assert.ok(OVERDUE_COUNTED_KIND_CODES.includes("SZ"));
    assert.ok(OVERDUE_EXCLUDED_KIND_CODES.includes("SL"));
    for (const code of OVERDUE_EXCLUDED_KIND_CODES)
      assert.equal(EXTERNAL_KIND_TYPES[code], "DELIVERY_NOTE");
    const r = summarizeOverdueInvoices(
      [
        row({ kindCode: "SL" }),
        row({ kindCode: "D" }),
        row({ kindCode: "sz" }),
      ],
      now,
    );
    assert.equal(r.overdue.count, 2);
  });
});

describe("Lejáró számlák: the rule", () => {
  it("an unpaid invoice past its due day is overdue, with its full open amount", () => {
    const r = summarizeOverdueInvoices([row({})], now);
    assert.deepEqual(r.overdue, {
      count: 1,
      openAmounts: [{ currency: "HUF", amount: "12700" }],
    });
  });

  it("a partially paid one counts with its OPEN part only", () => {
    const r = summarizeOverdueInvoices(
      [row({ paidAmount: new Prisma.Decimal("5000") })],
      now,
    );
    assert.deepEqual(r.overdue.openAmounts, [
      { currency: "HUF", amount: "7700" },
    ]);
  });

  it("a paid one is never due: by recorded payment, by card or by cash at ordering", () => {
    const r = summarizeOverdueInvoices(
      [
        row({ paidAmount: new Prisma.Decimal("12700") }),
        row({ paymentsKnown: false, paymentMethod: "Bankkártya" }),
        row({ paymentsKnown: false, paymentMethod: "Készpénz" }),
      ],
      now,
    );
    assert.equal(r.overdue.count, 0);
  });

  it("UNKNOWN (no payment data) is NEVER overdue: it is its own figure", () => {
    const r = summarizeOverdueInvoices(
      [
        row({ paymentsKnown: null }),
        row({ paymentsKnown: false, paymentMethod: "Kitalált fizetési mód" }),
      ],
      now,
    );
    assert.equal(r.overdue.count, 0);
    assert.equal(r.noPaymentDataPastDue, 2);
  });

  it("a cancelled invoice and a negative storno are not due", () => {
    const r = summarizeOverdueInvoices(
      [
        row({ cancelled: true }),
        row({
          grossAmount: new Prisma.Decimal("-12700"),
          paidAmount: new Prisma.Decimal("-12700"),
        }),
      ],
      now,
    );
    assert.equal(r.overdue.count, 0);
  });

  it("buckets by Budapest calendar day: overdue / today / within 7 days, nothing beyond", () => {
    const r = summarizeOverdueInvoices(
      [
        row({ dueDate: day("2026-10-01") }), // yesterday: overdue
        row({ dueDate: day("2026-10-02") }), // today
        row({ dueDate: day("2026-10-03") }), // tomorrow
        row({ dueDate: day("2026-10-09") }), // the 7th day
        row({ dueDate: day("2026-10-10") }), // beyond
        row({ dueDate: null }),
      ],
      now,
    );
    assert.deepEqual([r.overdue.count, r.dueToday, r.dueWithinWeek], [1, 1, 2]);
  });

  it("just after midnight in Budapest it is already the next day", () => {
    // 22:30 UTC on 1 Oct = 00:30 on 2 Oct in Budapest: a 1 Oct due date is overdue
    const r = summarizeOverdueInvoices(
      [row({ dueDate: day("2026-10-01") })],
      new Date("2026-10-01T22:30:00Z"),
    );
    assert.equal(r.overdue.count, 1);
  });

  it("keeps currencies apart, HUF first", () => {
    const r = summarizeOverdueInvoices(
      [
        row({ currency: "EUR", grossAmount: new Prisma.Decimal("100.5") }),
        row({}),
      ],
      now,
    );
    assert.deepEqual(r.overdue.openAmounts, [
      { currency: "HUF", amount: "12700" },
      { currency: "EUR", amount: "100.50" },
    ]);
  });
});
