import { Prisma } from "@acropora/database";
import { paymentStateOf } from "@acropora/types";

/**
 * WHICH OF OUR INVOICES A PROVEN CASH-ON-DELIVERY TRANSFER PAID, PER INVOICE,
 * the same for every carrier (GLS, Foxpost; Balázs, 2026-10-01 21:35 UTC). The
 * carrier proves the transfer and tells how much it collected per invoice; this
 * decides, invoice by invoice, whether that may be marked paid in Számlázz.hu.
 *
 * The mark is the invoice's GROSS (acrobot 25898: a false 1 Ft open item is
 * worse than a note). Cash on delivery is rounded to 5 Ft, so a collected sum
 * within 2 Ft of the gross is the gross, and the note says what was collected.
 */

/** 2 Ft: the 5 Ft cash rounding (barracuda, 105 830 collected on 105 831). */
export const COD_ROUNDING = new Prisma.Decimal(2);

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

export type CodInvoiceSkip =
  | "NOT_FOUND"
  | "CANCELLED"
  | "FOREIGN_CURRENCY"
  | "AMOUNT_MISMATCH"
  | "PAYMENTS_UNKNOWN"
  | "ALREADY_PAID"
  | "PARTLY_PAID";

export interface CodPaidMark {
  readonly invoiceNumber: string;
  readonly date: string;
  /** The invoice's gross, as Számlázz.hu's `osszeg`. */
  readonly amount: string;
  readonly title: "utánvét";
  readonly note: string;
}

export function codInvoiceMarks(input: {
  /** invoice number -> what the carrier collected for it */
  readonly collected: ReadonlyMap<string, Prisma.Decimal>;
  readonly invoices: ReadonlyMap<string, OutgoingInvoiceInput>;
  /** The payment's day in Számlázz.hu. */
  readonly date: string;
  /** The note's start: `GLS utánvét, 2026-09-17`. */
  readonly label: string;
}): {
  marks: CodPaidMark[];
  skipped: { invoiceNumber: string; reason: CodInvoiceSkip }[];
} {
  const marks: CodPaidMark[] = [];
  const skipped: { invoiceNumber: string; reason: CodInvoiceSkip }[] = [];
  for (const [number, amount] of input.collected) {
    const invoice = input.invoices.get(number);
    const skip = !invoice
      ? "NOT_FOUND"
      : invoice.cancelled || invoice.grossAmount.lte(0)
        ? "CANCELLED"
        : invoice.currency.toUpperCase() !== "HUF"
          ? "FOREIGN_CURRENCY"
          : amount.minus(invoice.grossAmount).abs().gt(COD_ROUNDING)
            ? "AMOUNT_MISMATCH"
            : !invoice.paymentsKnown
              ? "PAYMENTS_UNKNOWN"
              : null;
    if (skip) {
      skipped.push({ invoiceNumber: number, reason: skip });
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
      skipped.push({
        invoiceNumber: number,
        reason: state === "PAID" ? "ALREADY_PAID" : "PARTLY_PAID",
      });
      continue;
    }
    const gross = invoice!.grossAmount;
    marks.push({
      invoiceNumber: number,
      date: input.date,
      amount: gross.toFixed(0),
      title: "utánvét",
      note: amount.equals(gross)
        ? input.label
        : `${input.label}, 5 Ft-os kerekítés: beszedve ${amount.toFixed(0)}`,
    });
  }
  return {
    marks: marks.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    skipped,
  };
}
