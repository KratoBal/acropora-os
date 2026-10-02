import { prisma } from "@acropora/database";
import { outgoingMissingPayments } from "@acropora/types";

import { externalDocumentType } from "../../billing/billing-document-list.js";
import {
  decideSimplePayOrder,
  type CardInvoiceInput,
  type SimplePayOrderDecision,
  type SimplePayOrderSkip,
  type SimplePaySettlementLineInput,
} from "./simplepay-paid-marks.js";
import { UNAS_SHOP_ORDER_PREFIX } from "./simplepay-settlement.repository.js";

/**
 * THE DRY RUN OF THE SIMPLEPAY PAID MARKS: which card invoices would be marked
 * paid in Számlázz.hu, read from the stored data, and NOTHING written. Balázs
 * sees this list before any real write, as with GLS (acrobot 25994).
 *
 * The switch `SIMPLEPAY_MARK_PAID`: `off` (default), `dry`, `live`. This slice
 * only has the dry run; `live` is the next, separately approved slice.
 */
/** `auto`: a napi ütemezett futás minden jelölhetőt beír (acrobot 26101). */
export type SimplePayMarkPaidMode = "off" | "dry" | "live" | "auto";

export function simplePayMarkPaidMode(
  value: string | undefined,
): SimplePayMarkPaidMode {
  const v = value?.trim();
  return v === "dry" || v === "live" || v === "auto" ? v : "off";
}

/** The feed's order number prefix ("47679-"), from the SimplePay side's. */
const SHOP = UNAS_SHOP_ORDER_PREFIX.replace(/^UNAS-/, "");

const day = (value: Date) => value.toISOString().slice(0, 10);

export interface SimplePayOrderInput {
  readonly orderKey: string;
  readonly lines: SimplePaySettlementLineInput[];
  readonly invoices: CardInvoiceInput[];
}

/**
 * The orders a COMPLETED SimplePay line paid since `from`, with ALL their
 * settlement lines (a refund may sit in a later or an earlier weekly report)
 * and our invoices on the order number, read only. A COMPLETED line with no
 * order key cannot be tied to an invoice: only counted, for the report.
 */
export async function loadSimplePayOrders(from: string): Promise<{
  orders: SimplePayOrderInput[];
  unkeyed: number;
}> {
  const since = { gte: new Date(`${from}T00:00:00Z`) };
  const settled = await prisma.simplePayTransactionLine.findMany({
    where: { transactionStatus: "COMPLETED", transactionDate: since },
    select: { orderKeySuffix: true },
  });
  const keys = [
    ...new Set(
      settled
        .map((line) => line.orderKeySuffix)
        .filter((key): key is string => key !== null),
    ),
  ].sort();
  const unkeyed = settled.filter((line) => line.orderKeySuffix === null).length;
  if (keys.length === 0) return { orders: [], unkeyed };

  const lines = await loadSimplePayLinesByOrder(keys);
  const documents = await prisma.externalBillingDocument.findMany({
    where: {
      // only Számlázz.hu's own invoices can be marked paid there (not eBIZ)
      source: "SZAMLAZZ",
      orderNumber: { in: keys.map((key) => `${SHOP}${key}`) },
    },
    orderBy: { documentNumber: "asc" },
    select: {
      documentNumber: true,
      kindCode: true,
      orderNumber: true,
      grossAmount: true,
      currency: true,
      cancelled: true,
      paymentsKnown: true,
      paidAmount: true,
      paymentMethod: true,
      paymentMethodUnified: true,
    },
  });
  return {
    orders: keys.map((key) => ({
      orderKey: key,
      lines: lines.get(key) ?? [],
      // invoices only: a proforma or a delivery note on the order is not paid
      invoices: documents
        .filter(
          (d) =>
            d.orderNumber === `${SHOP}${key}` &&
            externalDocumentType(d.kindCode) === "INVOICE",
        )
        .map((d) => ({
          invoiceNumber: d.documentNumber,
          grossAmount: d.grossAmount,
          currency: d.currency,
          cancelled: d.cancelled,
          paymentsKnown: d.paymentsKnown,
          paidAmount: d.paidAmount,
          missingPayments: outgoingMissingPayments(
            d.paymentMethod,
            d.paymentMethodUnified,
          ),
        })),
    })),
    unkeyed,
  };
}

/** Every settlement line of the orders, from any weekly report, by order key. */
export async function loadSimplePayLinesByOrder(
  keys: readonly string[],
): Promise<Map<string, SimplePaySettlementLineInput[]>> {
  const out = new Map<string, SimplePaySettlementLineInput[]>();
  if (keys.length === 0) return out;
  const lines = await prisma.simplePayTransactionLine.findMany({
    where: { orderKeySuffix: { in: [...keys] } },
    orderBy: [{ transactionDate: "asc" }, { simplePayTransactionId: "asc" }],
    select: {
      orderKeySuffix: true,
      simplePayTransactionId: true,
      transactionStatus: true,
      amount: true,
      currency: true,
      transactionDate: true,
    },
  });
  for (const line of lines) {
    const key = line.orderKeySuffix!;
    out.set(key, [
      ...(out.get(key) ?? []),
      {
        transactionId: line.simplePayTransactionId,
        transactionStatus: line.transactionStatus,
        amount: line.amount,
        currency: line.currency,
        transactionDate: day(line.transactionDate),
      },
    ]);
  }
  return out;
}

const SKIP_TEXT: Record<SimplePayOrderSkip, string> = {
  NO_INVOICE: "a rendeléshez nincs kimenő számla",
  CANCELLED: "sztornózott",
  SEVERAL_INVOICES: "a rendeléshez több élő számla tartozik",
  PAYMENTS_UNKNOWN: "a kifizetései még nem ismertek (nincs újravetítve)",
  ALREADY_PAID: "már kifizetett (a Számlázz.hu szerint)",
  PARTLY_PAID: "részben kifizetett: kérdés, nem jelölés",
  NOT_CARD: "nem kártyás számla",
  FOREIGN_CURRENCY: "devizás",
  UNKNOWN_STATUS: "a SimplePay-sorok között ismeretlen állapotú is van",
  NOT_SETTLED: "nincs teljesült SimplePay-fizetés",
  REFUNDED: "visszatérítve: nem fizetés",
  PARTLY_REFUNDED: "részben visszatérítve: kérdés, nem jelölés",
  AMOUNT_MISMATCH: "a kártyás fizetés nem a számla bruttója",
};

/** The list Balázs reads: the marks, then the skipped orders with the reason. */
export function dryRunReport(
  decisions: readonly SimplePayOrderDecision[],
  unkeyed: number,
): string {
  const out: string[] = [];
  const marks = decisions
    .flatMap((d) => (d.markable ? [d.mark] : []))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.invoiceNumber.localeCompare(b.invoiceNumber),
    );
  for (const m of marks)
    out.push(
      `${m.invoiceNumber}\t${m.amount} Ft\t${m.date}\t${m.title}\t${m.note}`,
    );
  for (const d of decisions) {
    if (d.markable) continue;
    const money =
      d.refunded === "0"
        ? `fizetve ${d.completed} Ft`
        : `fizetve ${d.completed} Ft, visszatérítve ${d.refunded} Ft`;
    out.push(
      `${d.invoiceNumber ?? "-"}\trendelés ${SHOP}${d.orderKey}\t${money}\tkimarad: ${SKIP_TEXT[d.reason]}`,
    );
  }
  if (unkeyed > 0)
    out.push(
      `${unkeyed} teljesült SimplePay-fizetés rendelésszám nélkül: számlához nem köthető`,
    );
  out.push(
    `összesen: ${marks.length} számla jelölhető, ${decisions.length} rendelésből`,
  );
  return out.join("\n") + "\n";
}

export async function simplePayPaidMarksDryRun(from: string): Promise<string> {
  const { orders, unkeyed } = await loadSimplePayOrders(from);
  return dryRunReport(
    orders.map((order) => decideSimplePayOrder(order)),
    unkeyed,
  );
}
