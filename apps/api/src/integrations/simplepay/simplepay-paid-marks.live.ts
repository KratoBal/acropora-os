import { prisma } from "@acropora/database";

import { simplePayOrderKey } from "../../billing/billing-document-list.js";
import type { PaymentMarkInput } from "../szamlazz/outgoing-payment-marks.js";
import { loadSimplePayLinesByOrder } from "./simplepay-paid-marks.dry-run.js";
import type { SimplePayOrderDecision } from "./simplepay-paid-marks.js";
import {
  refundsAfterMarks,
  type RefundAfterMark,
} from "./simplepay-paid-marks.refunds.js";
import { UNAS_SHOP_ORDER_PREFIX } from "./simplepay-settlement.repository.js";

/**
 * THE SIMPLEPAY SIDE OF THE LIVE SLICE (acrobot 25997, 26002): what goes into
 * the shared writer (#1386, one log table for every source), and what only
 * SimplePay needs around it. The write itself, the log and its PLANNED /
 * UNKNOWN / FAILED rules are the shared loop's, not repeated here.
 */

/**
 * The marks of the approved invoices, and nothing else. An invoice that a
 * SimplePay mark already touched (any day, any state but FAILED) is left out:
 * the shared key is (source, invoice, day), and a card invoice is paid once,
 * so a second SimplePay day for it can only be a second payment. The writer's
 * own re-read of the invoice is the second guard, not the only one.
 */
export function simplePayMarksToWrite(input: {
  readonly decisions: readonly SimplePayOrderDecision[];
  readonly approved: ReadonlySet<string>;
  /** Invoices with a SIMPLEPAY log row that is not FAILED. */
  readonly markedBefore: ReadonlySet<string>;
}): { marks: PaymentMarkInput[]; markedBefore: string[] } {
  const marks: PaymentMarkInput[] = [];
  const skipped: string[] = [];
  for (const decision of input.decisions) {
    if (!decision.markable) continue;
    const { mark } = decision;
    if (!input.approved.has(mark.invoiceNumber)) continue;
    if (input.markedBefore.has(mark.invoiceNumber)) {
      skipped.push(mark.invoiceNumber);
      continue;
    }
    marks.push({
      invoiceNumber: mark.invoiceNumber,
      date: mark.date,
      amount: mark.amount,
      title: mark.title,
      note: mark.note,
      sourceRef: mark.sourceRef,
    });
  }
  return {
    marks: marks.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
    markedBefore: skipped.sort(),
  };
}

/**
 * The approved invoices that already have a SimplePay log row which is not
 * FAILED (a FAILED row wrote nothing in Számlázz.hu).
 */
export async function loadSimplePayMarkedBefore(
  invoiceNumbers: ReadonlySet<string>,
): Promise<Set<string>> {
  if (invoiceNumbers.size === 0) return new Set();
  const rows = await prisma.outgoingPaymentMark.findMany({
    where: {
      source: "SIMPLEPAY",
      invoiceNumber: { in: [...invoiceNumbers] },
      state: { not: "FAILED" },
    },
    select: { invoiceNumber: true },
  });
  return new Set(rows.map((row) => row.invoiceNumber));
}

/** Every SimplePay mark Számlázz.hu accepted, from the shared log. */
export async function loadWrittenSimplePayMarks(): Promise<
  { invoiceNumber: string; date: string; amount: string }[]
> {
  const rows = await prisma.outgoingPaymentMark.findMany({
    where: { source: "SIMPLEPAY", state: "WRITTEN" },
    orderBy: { invoiceNumber: "asc" },
    select: { invoiceNumber: true, markDate: true, amount: true },
  });
  return rows.map((row) => ({
    invoiceNumber: row.invoiceNumber,
    date: row.markDate.toISOString().slice(0, 10),
    amount: row.amount.toFixed(0),
  }));
}

/**
 * The written SimplePay marks whose order got a refund since, read only. The
 * written marks come from the shared log; the order from the invoice's feed
 * row, the lines from every weekly report.
 */
export async function loadRefundsAfterMarks(
  written: readonly {
    readonly invoiceNumber: string;
    readonly date: string;
    readonly amount: string;
  }[],
): Promise<RefundAfterMark[]> {
  if (written.length === 0) return [];
  const documents = await prisma.externalBillingDocument.findMany({
    where: {
      source: "SZAMLAZZ",
      documentNumber: { in: written.map((w) => w.invoiceNumber) },
    },
    orderBy: { feedReceivedAt: "desc" },
    select: { documentNumber: true, orderNumber: true },
  });
  const orderOf = new Map<string, string>();
  for (const d of documents) {
    const key = simplePayOrderKey(d.orderNumber, UNAS_SHOP_ORDER_PREFIX);
    // the latest feed version first: it wins
    if (key && !orderOf.has(d.documentNumber))
      orderOf.set(d.documentNumber, key);
  }
  const marks = written.flatMap((w) => {
    const orderKey = orderOf.get(w.invoiceNumber);
    return orderKey ? [{ ...w, orderKey }] : [];
  });
  const lines = await loadSimplePayLinesByOrder([
    ...new Set(marks.map((m) => m.orderKey)),
  ]);
  return refundsAfterMarks(marks, lines);
}
