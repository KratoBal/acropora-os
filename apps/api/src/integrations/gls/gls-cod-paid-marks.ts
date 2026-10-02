import { Prisma } from "@acropora/database";

import {
  COD_ROUNDING as ROUNDING,
  codInvoiceMarks,
  type CodInvoiceSkip,
  type CodPaidMark,
  type OutgoingInvoiceInput,
} from "../szamlazz/cod-invoice-marks.js";

export type { OutgoingInvoiceInput };

/**
 * WHICH OF OUR INVOICES A GLS COD TRANSFER PAID, AND MAY BE MARKED PAID IN
 * SZÁMLÁZZ.HU (Balázs, GLS thread, 2026-10-01 18:33 UTC; acrobot 25883; plan:
 * agents/nautilus/megosztas/gls-utanvet-kifizetett-terv-2026-10-01.md).
 *
 * A pure decision, one transfer day at a time. Nothing is written here: the
 * dry run lists the result for Balázs, and the real write is a separate,
 * approved step.
 *
 * A transfer is MARKABLE only when all three hold (barracuda's key, measured
 * on September):
 *   1. the COD report is complete: every line resolved to our invoices;
 *   2. if a compensation letter exists for the day, its COD equals the
 *      report's total, and the transferred sum is the letter's; otherwise the
 *      transferred sum is the report's total. What the letter set off must be
 *      GLS INVOICES (acrobot 25971): then the difference paid our debt to
 *      GLS, and the buyer's COD was collected in full (09-03: 8 013 Ft set off
 *      against HU00912382). A set-off against anything else (the letter may
 *      name a parcel) can be the buyer's money taken back, so the transfer is
 *      refused, not guessed;
 *   3. exactly one GLS bank credit that day, of exactly that sum.
 *
 * Per invoice of a markable transfer, the mark is the invoice's GROSS, dated
 * the transfer day (acrobot 25898: a false 1 Ft open item is worse than a
 * note). Cash on delivery is rounded to 5 Ft, so a collected sum within 2 Ft
 * of the gross is the gross, and the note says what was collected.
 */

export interface GlsCodReportInput {
  readonly transferDate: string;
  readonly total: Prisma.Decimal;
  readonly lines: readonly {
    readonly parcelNumber: string;
    readonly amount: Prisma.Decimal;
    readonly status: "RESOLVED" | "NEEDS_REVIEW";
    readonly invoiceNumbers: readonly string[];
  }[];
}

export interface GlsCompensationInput {
  readonly cod: Prisma.Decimal;
  readonly transferred: Prisma.Decimal;
  /** What was set off, in the letter's order: GLS invoice or parcel numbers. */
  readonly references: readonly string[];
}

/** A GLS invoice number, as the compensation letter names it (`HU00912382`). */
const GLS_INVOICE = /^HU\d{8}$/;

export type GlsTransferRefusal =
  | "REPORT_NEEDS_REVIEW"
  | "COMPENSATION_MISMATCH"
  | "COMPENSATION_NOT_GLS_INVOICE"
  | "NO_CREDIT"
  | "AMBIGUOUS_CREDIT";

export type GlsInvoiceSkip = CodInvoiceSkip | "MULTI_INVOICE_LINE";

export type GlsPaidMark = CodPaidMark;

export type GlsTransferDecision =
  | {
      readonly transferDate: string;
      readonly markable: false;
      readonly refusal: GlsTransferRefusal;
      readonly transferred: string;
    }
  | {
      readonly transferDate: string;
      readonly markable: true;
      readonly transferred: string;
      readonly creditId: string;
      readonly marks: readonly GlsPaidMark[];
      readonly skipped: readonly {
        readonly invoiceNumber: string;
        readonly reason: GlsInvoiceSkip;
      }[];
    };

export function decideGlsTransfer(input: {
  readonly report: GlsCodReportInput;
  readonly compensation: GlsCompensationInput | null;
  /** The GLS bank credits booked on the transfer day. */
  readonly credits: readonly {
    readonly id: string;
    readonly amount: Prisma.Decimal;
  }[];
  readonly invoices: ReadonlyMap<string, OutgoingInvoiceInput>;
}): GlsTransferDecision {
  const { report, compensation } = input;
  const transferred = compensation ? compensation.transferred : report.total;
  const refuse = (refusal: GlsTransferRefusal): GlsTransferDecision => ({
    transferDate: report.transferDate,
    markable: false,
    refusal,
    transferred: transferred.toFixed(0),
  });
  // a line in review holds the whole transfer back: a wrong invoice marked
  // paid is worse than a late one
  if (report.lines.some((line) => line.status !== "RESOLVED"))
    return refuse("REPORT_NEEDS_REVIEW");
  if (compensation && !compensation.cod.equals(report.total))
    return refuse("COMPENSATION_MISMATCH");
  if (
    compensation &&
    !compensation.transferred.equals(compensation.cod) &&
    (compensation.references.length === 0 ||
      !compensation.references.every((r) => GLS_INVOICE.test(r)))
  )
    return refuse("COMPENSATION_NOT_GLS_INVOICE");
  const credits = input.credits.filter((credit) =>
    credit.amount.equals(transferred),
  );
  if (credits.length === 0) return refuse("NO_CREDIT");
  if (credits.length > 1) return refuse("AMBIGUOUS_CREDIT");

  // collected per invoice; a line paying several invoices only when the sum
  // of their grosses is the line, within the rounding
  const collected = new Map<string, Prisma.Decimal>();
  const skipped = new Map<string, GlsInvoiceSkip>();
  for (const line of report.lines) {
    if (line.invoiceNumbers.length === 1) {
      const number = line.invoiceNumbers[0]!;
      collected.set(
        number,
        (collected.get(number) ?? new Prisma.Decimal(0)).plus(line.amount),
      );
      continue;
    }
    const grosses = line.invoiceNumbers.map(
      (number) => input.invoices.get(number)?.grossAmount ?? null,
    );
    const sum = grosses.reduce<Prisma.Decimal | null>(
      (total, gross) => (total && gross ? total.plus(gross) : null),
      new Prisma.Decimal(0),
    );
    if (!sum || sum.minus(line.amount).abs().gt(ROUNDING)) {
      for (const number of line.invoiceNumbers)
        skipped.set(number, "MULTI_INVOICE_LINE");
      continue;
    }
    line.invoiceNumbers.forEach((number, index) =>
      collected.set(
        number,
        (collected.get(number) ?? new Prisma.Decimal(0)).plus(grosses[index]!),
      ),
    );
  }

  for (const number of skipped.keys()) collected.delete(number);
  const { marks, skipped: invoiceSkips } = codInvoiceMarks({
    collected,
    invoices: input.invoices,
    date: report.transferDate,
    label: `GLS utánvét, ${report.transferDate}`,
  });
  for (const skip of invoiceSkips) skipped.set(skip.invoiceNumber, skip.reason);
  return {
    transferDate: report.transferDate,
    markable: true,
    transferred: transferred.toFixed(0),
    creditId: credits[0]!.id,
    marks,
    skipped: [...skipped]
      .map(([invoiceNumber, reason]) => ({ invoiceNumber, reason }))
      .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
  };
}
