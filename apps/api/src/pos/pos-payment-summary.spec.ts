import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  budapestDay,
  daysBetween,
  summarizePosPayments,
  type PosPaymentRow,
} from "./pos-payment-summary.js";

/*
  What turns this red: CASH_DESK folded into CASH (the whole point of the
  Kassza method is its own line), a sale at 00:30 local counted on the day
  before (winter AND summer offset), a sale without a payment method lost, or
  a day without sales missing from the table.
*/
function row(
  createdAt: string,
  paymentMethod: PosPaymentRow["paymentMethod"],
  gross: string,
): PosPaymentRow {
  return {
    createdAt: new Date(createdAt),
    paymentMethod,
    totalGross: new Prisma.Decimal(gross),
  };
}

describe("summarizePosPayments", () => {
  it("keeps CASH_DESK on its own line next to CASH, per day and in total", () => {
    const result = summarizePosPayments("2026-10-29", "2026-10-29", [
      row("2026-10-29T08:00:00Z", "CASH", "1000"),
      row("2026-10-29T09:00:00Z", "CASH_DESK", "2500.50"),
      row("2026-10-29T10:00:00Z", "CASH_DESK", "500"),
      row("2026-10-29T11:00:00Z", "CARD", "700"),
    ]);

    assert.deepEqual(result.methods, ["CARD", "CASH", "CASH_DESK"]);
    const day = result.days[0]!;
    assert.deepEqual(day.byMethod.CASH, { count: 1, totalGross: "1000.00" });
    assert.deepEqual(day.byMethod.CASH_DESK, {
      count: 2,
      totalGross: "3000.50",
    });
    assert.deepEqual(day.byMethod.CARD, { count: 1, totalGross: "700.00" });
    assert.deepEqual(day.total, { count: 4, totalGross: "4700.50" });
    assert.deepEqual(result.totals.byMethod.CASH_DESK, day.byMethod.CASH_DESK);
    assert.deepEqual(result.totals.total, day.total);
  });

  it("splits the days at Budapest midnight, in winter and in summer time", () => {
    assert.equal(budapestDay(new Date("2026-10-28T23:30:00Z")), "2026-10-29");
    assert.equal(budapestDay(new Date("2026-08-08T22:30:00Z")), "2026-08-09");
    assert.equal(budapestDay(new Date("2026-08-08T21:30:00Z")), "2026-08-08");

    const result = summarizePosPayments("2026-10-28", "2026-10-29", [
      row("2026-10-28T22:30:00Z", "CARD", "100"), // 23:30 on the 28th (CET)
      row("2026-10-28T23:30:00Z", "CARD", "200"), // 00:30 on the 29th
    ]);
    assert.equal(result.days[0]!.byMethod.CARD!.totalGross, "100.00");
    assert.equal(result.days[1]!.byMethod.CARD!.totalGross, "200.00");
  });

  it("ignores rows outside the requested days (the read is padded)", () => {
    const result = summarizePosPayments("2026-10-29", "2026-10-29", [
      row("2026-10-28T10:00:00Z", "CARD", "999"),
      row("2026-10-30T10:00:00Z", "CARD", "999"),
    ]);
    assert.deepEqual(result.totals.total, { count: 0, totalGross: "0.00" });
  });

  it("lists every requested day, sales or not, oldest first", () => {
    const result = summarizePosPayments("2026-10-27", "2026-10-29", [
      row("2026-10-29T08:00:00Z", "CARD", "100"),
    ]);
    assert.deepEqual(
      result.days.map((day) => day.date),
      ["2026-10-27", "2026-10-28", "2026-10-29"],
    );
    assert.deepEqual(result.days[0]!.total, { count: 0, totalGross: "0.00" });
    assert.deepEqual(result.days[0]!.byMethod.CASH_DESK, {
      count: 0,
      totalGross: "0.00",
    });
  });

  it("shows TRANSFER and the unknown method only when a sale has them", () => {
    const without = summarizePosPayments("2026-10-29", "2026-10-29", [
      row("2026-10-29T08:00:00Z", "CARD", "100"),
    ]);
    assert.deepEqual(without.methods, ["CARD", "CASH", "CASH_DESK"]);

    const withBoth = summarizePosPayments("2026-10-29", "2026-10-29", [
      row("2026-10-29T08:00:00Z", "TRANSFER", "300"),
      row("2026-10-29T09:00:00Z", null, "50"),
    ]);
    assert.deepEqual(withBoth.methods, [
      "CARD",
      "CASH",
      "CASH_DESK",
      "TRANSFER",
      "UNKNOWN",
    ]);
    assert.deepEqual(withBoth.totals.byMethod.UNKNOWN, {
      count: 1,
      totalGross: "50.00",
    });
    assert.deepEqual(withBoth.totals.total, { count: 2, totalGross: "350.00" });
  });
});

describe("daysBetween", () => {
  it("is inclusive on both ends and crosses a month end", () => {
    assert.deepEqual(daysBetween("2026-10-30", "2026-11-01"), [
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    assert.deepEqual(daysBetween("2026-10-29", "2026-10-29"), ["2026-10-29"]);
  });
});
