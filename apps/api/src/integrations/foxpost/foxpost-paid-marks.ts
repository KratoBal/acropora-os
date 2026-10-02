import { Prisma } from "@acropora/database";

import type { PaymentMarkInput } from "../szamlazz/outgoing-payment-marks.js";
import {
  codInvoiceMarks,
  type CodInvoiceSkip,
  type CodPaidMark,
  type OutgoingInvoiceInput,
} from "../szamlazz/cod-invoice-marks.js";

/**
 * WHICH OF OUR INVOICES A FOXPOST SETTLEMENT PAID, AND MAY BE MARKED PAID IN
 * SZÁMLÁZZ.HU (Balázs, 2026-10-01 21:35 UTC; acrobot 25982, 25993). The GLS
 * pattern (`gls-cod-paid-marks.ts`), for the weekly Foxpost settlement.
 *
 * A pure decision, one settlement at a time. Nothing is written here.
 *
 * A settlement is MARKABLE only when all of these hold:
 *   1. it was read whole (COMPLETED or NEEDS_REVIEW: the review is about our
 *      internal orders, not the money), with its three sums;
 *   2. its own sums agree: the lines add up to the collected COD, and the COD
 *      minus the Foxpost invoice set off against it is the transferred sum
 *      (barracuda: the Foxpost invoice is set off in the transfer);
 *   3. exactly one bank credit names the settlement (`FOXPOST 26H38 W0166840`,
 *      measured on the statements) and is exactly the transferred sum.
 *
 * A line's reference is the webshop order number (`47679-279201`) or, rarely,
 * an invoice number. It resolves to our invoice through the forwarded outgoing
 * invoices (`ExternalBillingDocument.orderNumber`, murena #1377; barracuda
 * 15/15). Only a LIVE invoice counts (not cancelled, positive gross): an order
 * whose invoice was cancelled has a storno pair (47679-279201: 00483 + and
 * 00490 -), and with no live invoice left the line is skipped, not guessed.
 * Two live invoices for one order are skipped too.
 */

export interface FoxpostSettlementInput {
  readonly settlementCode: string;
  readonly partnerCode: string | null;
  readonly status: "PROCESSING" | "COMPLETED" | "NEEDS_REVIEW" | "ERROR";
  readonly collectedAmount: Prisma.Decimal | null;
  /** The Foxpost invoice set off against the COD. */
  readonly invoiceGrossAmount: Prisma.Decimal | null;
  readonly transferredAmount: Prisma.Decimal | null;
  /** Az olvasás hibakódja (ERROR állapotnál), hogy a lista megnevezze. */
  readonly errorCode?: string | null;
  readonly lines: readonly {
    readonly referenceCode: string;
    readonly collectedAmount: Prisma.Decimal;
  }[];
}

/** One forwarded outgoing invoice, as a line's reference may find it. */
export interface FoxpostCandidateInvoice {
  readonly invoiceNumber: string;
  readonly orderNumber: string | null;
  readonly grossAmount: Prisma.Decimal;
  readonly cancelled: boolean;
}

export type FoxpostSettlementRefusal =
  | "SETTLEMENT_INCOMPLETE"
  | "SETTLEMENT_INCONSISTENT"
  | "NO_CREDIT"
  | "AMBIGUOUS_CREDIT";

export type FoxpostSkip =
  | CodInvoiceSkip
  /** the order has invoices, but none is live (a storno pair) */
  | "NO_LIVE_INVOICE"
  | "MULTIPLE_INVOICES";

export type FoxpostSettlementDecision =
  | {
      readonly settlementCode: string;
      readonly markable: false;
      readonly refusal: FoxpostSettlementRefusal;
      readonly transferred: string | null;
      /** Ha az elszámolás olvasása elbukott: a hibakódja. */
      readonly errorCode?: string;
    }
  | {
      readonly settlementCode: string;
      readonly markable: true;
      readonly transferred: string;
      readonly creditId: string;
      readonly creditDate: string;
      readonly marks: readonly CodPaidMark[];
      readonly skipped: readonly {
        /** the line's reference, or the invoice it resolved to */
        readonly reference: string;
        readonly reason: FoxpostSkip;
      }[];
    };

/** The bank narrative of a Foxpost transfer names the settlement: `FOXPOST 26H38`. */
export const foxpostNarrativeMark = (settlementCode: string) =>
  `FOXPOST ${settlementCode}`;

const ZERO = new Prisma.Decimal(0);

export function decideFoxpostSettlement(input: {
  readonly settlement: FoxpostSettlementInput;
  /** The bank credits whose narrative names the settlement. */
  readonly credits: readonly {
    readonly id: string;
    readonly amount: Prisma.Decimal;
    /** ÉÉÉÉ-HH-NN */
    readonly bookingDate: string;
  }[];
  /** Every forwarded outgoing invoice a line's reference names. */
  readonly candidates: readonly FoxpostCandidateInvoice[];
  readonly invoices: ReadonlyMap<string, OutgoingInvoiceInput>;
}): FoxpostSettlementDecision {
  const { settlement } = input;
  const refuse = (
    refusal: FoxpostSettlementRefusal,
  ): FoxpostSettlementDecision => ({
    settlementCode: settlement.settlementCode,
    markable: false,
    refusal,
    transferred: settlement.transferredAmount?.toFixed(0) ?? null,
    ...(refusal === "SETTLEMENT_INCOMPLETE" && settlement.errorCode
      ? { errorCode: settlement.errorCode }
      : {}),
  });
  const { collectedAmount, invoiceGrossAmount, transferredAmount } = settlement;
  if (
    (settlement.status !== "COMPLETED" &&
      settlement.status !== "NEEDS_REVIEW") ||
    !collectedAmount ||
    !invoiceGrossAmount ||
    !transferredAmount
  )
    return refuse("SETTLEMENT_INCOMPLETE");
  const lineSum = settlement.lines.reduce(
    (sum, line) => sum.plus(line.collectedAmount),
    ZERO,
  );
  if (
    !lineSum.equals(collectedAmount) ||
    !collectedAmount.minus(invoiceGrossAmount).equals(transferredAmount)
  )
    return refuse("SETTLEMENT_INCONSISTENT");
  const credits = input.credits.filter((c) =>
    c.amount.equals(transferredAmount),
  );
  if (credits.length === 0) return refuse("NO_CREDIT");
  if (credits.length > 1) return refuse("AMBIGUOUS_CREDIT");
  const credit = credits[0]!;

  const skipped: { reference: string; reason: FoxpostSkip }[] = [];
  const collected = new Map<string, Prisma.Decimal>();
  for (const line of settlement.lines) {
    const named = input.candidates.filter(
      (c) =>
        c.orderNumber === line.referenceCode ||
        c.invoiceNumber === line.referenceCode,
    );
    const live = named.filter((c) => !c.cancelled && c.grossAmount.gt(0));
    if (live.length !== 1) {
      skipped.push({
        reference: line.referenceCode,
        reason:
          live.length > 1
            ? "MULTIPLE_INVOICES"
            : named.length
              ? "NO_LIVE_INVOICE"
              : "NOT_FOUND",
      });
      continue;
    }
    const number = live[0]!.invoiceNumber;
    collected.set(
      number,
      (collected.get(number) ?? ZERO).plus(line.collectedAmount),
    );
  }
  const { marks, skipped: invoiceSkips } = codInvoiceMarks({
    collected,
    invoices: input.invoices,
    date: credit.bookingDate,
    label: `Foxpost utánvét, ${settlement.settlementCode}`,
  });
  return {
    settlementCode: settlement.settlementCode,
    markable: true,
    transferred: transferredAmount.toFixed(0),
    creditId: credit.id,
    creditDate: credit.bookingDate,
    marks,
    skipped: [
      ...skipped,
      ...invoiceSkips.map((s) => ({
        reference: s.invoiceNumber,
        reason: s.reason,
      })),
    ].sort((a, b) => a.reference.localeCompare(b.reference)),
  };
}

/**
 * The marks of the markable settlements, for the shared Számlázz.hu loop
 * (`applyPaidMarks`, source FOXPOST). The settlement's bank credit is the
 * source-side reference: one transfer pays an invoice once (acrobot 26001).
 */
export function foxpostPaidMarkInputs(
  decisions: readonly FoxpostSettlementDecision[],
): PaymentMarkInput[] {
  return decisions.flatMap((decision) =>
    decision.markable
      ? decision.marks.map((mark) => ({
          invoiceNumber: mark.invoiceNumber,
          date: mark.date,
          amount: mark.amount,
          title: mark.title,
          note: mark.note,
          sourceRef: decision.creditId,
        }))
      : [],
  );
}
