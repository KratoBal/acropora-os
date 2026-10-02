import { Prisma } from "@acropora/database";

import type { SimplePaySettlementLineInput } from "./simplepay-paid-marks.js";

/**
 * A REFUND THAT ARRIVED AFTER THE MARK WAS WRITTEN (acrobot 25997). A mark is
 * written only when the order had no REFUND line, so ANY refund on a marked
 * order is news: the weekly report came after the write. It is REPORTED, never
 * written back: whether the answer is a negative payment, a corrective invoice
 * or a cancellation is Balázs's call, not ours.
 */
export interface WrittenSimplePayMark {
  readonly invoiceNumber: string;
  readonly orderKey: string;
  /** The day the mark carries (the SimplePay settlement day). */
  readonly date: string;
  readonly amount: string;
}

export interface RefundAfterMark {
  readonly invoiceNumber: string;
  readonly orderKey: string;
  readonly markDate: string;
  readonly markAmount: string;
  readonly refunded: string;
  /** The refund lines' days, ascending, without repeats. */
  readonly refundDates: readonly string[];
  /** Refunded at least what was paid by card on the order. */
  readonly full: boolean;
}

export function refundsAfterMarks(
  marks: readonly WrittenSimplePayMark[],
  linesByOrder: ReadonlyMap<string, readonly SimplePaySettlementLineInput[]>,
): RefundAfterMark[] {
  const out: RefundAfterMark[] = [];
  for (const mark of marks) {
    const lines = linesByOrder.get(mark.orderKey) ?? [];
    const refunds = lines.filter((l) => l.transactionStatus === "REFUND");
    if (refunds.length === 0) continue;
    const abs = (rows: readonly SimplePaySettlementLineInput[]) =>
      rows.reduce((t, l) => t.plus(l.amount.abs()), new Prisma.Decimal(0));
    const refunded = abs(refunds);
    const completed = abs(
      lines.filter((l) => l.transactionStatus === "COMPLETED"),
    );
    out.push({
      invoiceNumber: mark.invoiceNumber,
      orderKey: mark.orderKey,
      markDate: mark.date,
      markAmount: mark.amount,
      refunded: refunded.toFixed(0),
      refundDates: [...new Set(refunds.map((l) => l.transactionDate))].sort(),
      full: refunded.gte(completed),
    });
  }
  return out.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
}

/** The list Balázs reads after a run; empty string when there is nothing. */
export function refundsAfterMarksReport(
  rows: readonly RefundAfterMark[],
): string {
  if (rows.length === 0) return "";
  const out = [
    `FIGYELEM: ${rows.length} már beírt jelölés rendelésére később visszatérítés érkezett (nem írtam vissza semmit):`,
  ];
  for (const r of rows)
    out.push(
      `  ${r.invoiceNumber}\tbeírva ${r.markAmount} Ft, ${r.markDate}\tvisszatérítve ${r.refunded} Ft (${r.refundDates.join(", ")})\t${r.full ? "teljes" : "részleges"} visszatérítés`,
    );
  return out.join("\n") + "\n";
}
