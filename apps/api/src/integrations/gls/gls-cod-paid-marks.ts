import { Prisma } from "@acropora/database";
import { paymentStateOf } from "@acropora/types";

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
 *      transferred sum is the report's total;
 *   3. exactly one GLS bank credit that day, of exactly that sum.
 *
 * Per invoice of a markable transfer, the mark is the invoice's GROSS, dated
 * the transfer day (acrobot 25898: a false 1 Ft open item is worse than a
 * note). Cash on delivery is rounded to 5 Ft, so a collected sum within 2 Ft
 * of the gross is the gross, and the note says what was collected.
 */

/** 2 Ft: the 5 Ft cash rounding (barracuda, 105 830 collected on 105 831). */
const ROUNDING = new Prisma.Decimal(2);

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
}

/** What we know of one of our invoices (Számlázz.hu's feed or its Agent). */
export interface OutgoingInvoiceInput {
  readonly grossAmount: Prisma.Decimal;
  readonly currency: string;
  readonly cancelled: boolean;
  /**
   * Whether its payments are known: projected from a feed version (a missing
   * `kifizetesek` element there is "unpaid", acrobot 25910) or read from the
   * Agent. Unknown cannot prove "not paid yet", so it is never marked.
   */
  readonly paymentsKnown: boolean;
  readonly paidAmount: Prisma.Decimal;
}

export type GlsTransferRefusal =
  | "REPORT_NEEDS_REVIEW"
  | "COMPENSATION_MISMATCH"
  | "NO_CREDIT"
  | "AMBIGUOUS_CREDIT";

export type GlsInvoiceSkip =
  | "NOT_FOUND"
  | "CANCELLED"
  | "FOREIGN_CURRENCY"
  | "AMOUNT_MISMATCH"
  | "MULTI_INVOICE_LINE"
  | "PAYMENTS_UNKNOWN"
  | "ALREADY_PAID"
  | "PARTLY_PAID";

export interface GlsPaidMark {
  readonly invoiceNumber: string;
  readonly date: string;
  /** The invoice's gross, as Számlázz.hu's `osszeg`. */
  readonly amount: string;
  readonly title: "utánvét";
  readonly note: string;
}

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

  const marks: GlsPaidMark[] = [];
  for (const [number, amount] of collected) {
    if (skipped.has(number)) continue;
    const invoice = input.invoices.get(number);
    const skip = !invoice
      ? "NOT_FOUND"
      : invoice.cancelled || invoice.grossAmount.lte(0)
        ? "CANCELLED"
        : invoice.currency.toUpperCase() !== "HUF"
          ? "FOREIGN_CURRENCY"
          : amount.minus(invoice.grossAmount).abs().gt(ROUNDING)
            ? "AMOUNT_MISMATCH"
            : !invoice.paymentsKnown
              ? "PAYMENTS_UNKNOWN"
              : null;
    if (skip) {
      skipped.set(number, skip);
      continue;
    }
    // already paid by any source (Számlázz.hu's own bank pairing too): never
    // a second payment next to it; partly paid is a question, not a mark
    const state = paymentStateOf({
      paymentsKnown: true,
      paidAmount: invoice!.paidAmount.toFixed(),
      grossAmount: invoice!.grossAmount.toFixed(),
      currency: invoice!.currency,
    });
    if (state === "PAID" || state === "PARTIAL") {
      skipped.set(number, state === "PAID" ? "ALREADY_PAID" : "PARTLY_PAID");
      continue;
    }
    const gross = invoice!.grossAmount;
    const rounded = !amount.equals(gross);
    marks.push({
      invoiceNumber: number,
      date: report.transferDate,
      amount: gross.toFixed(0),
      title: "utánvét",
      note: rounded
        ? `GLS utánvét, ${report.transferDate}, 5 Ft-os kerekítés: beszedve ${amount.toFixed(0)}`
        : `GLS utánvét, ${report.transferDate}`,
    });
  }
  return {
    transferDate: report.transferDate,
    markable: true,
    transferred: transferred.toFixed(0),
    creditId: credits[0]!.id,
    marks: marks.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    skipped: [...skipped]
      .map(([invoiceNumber, reason]) => ({ invoiceNumber, reason }))
      .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
  };
}
