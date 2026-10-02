import type { EbizInvoiceDetail, EbizInvoiceListItem } from "./ebiz.client.js";

/**
 * HOW AN eBIZ INVOICE BECOMES AN `ExternalBillingDocument` ROW (source
 * `EBIZ`). Pure, so every mapping is tested without a database.
 *
 * The row sits next to the Számlázz.hu ones and is read by the same billing
 * list and detail; the fields therefore keep their meaning there.
 */

/**
 * eBIZ invoice type → the Számlázz.hu kind code the list already labels
 * (`EXTERNAL_KIND_TYPES` / `EXTERNAL_KIND_LABELS`). PARTIAL ("részszámla")
 * has no own code there and is an invoice; an unknown type stays as written,
 * which the list shows raw.
 */
const KIND_CODES: Readonly<Record<string, string>> = {
  INVOICE: "SZ",
  PARTIAL: "SZ",
  CANCELLATION: "SS",
  CORRECTIVE: "JS",
  ADVANCE: "ES",
  FINAL: "VS",
  PROFORMA: "D",
};

export function ebizKindCode(type: string): string {
  return KIND_CODES[type.toUpperCase()] ?? type.toUpperCase();
}

const day = (value: string | null | undefined): Date | null =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00Z`)
    : null;

const amount = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : "0.00";

/**
 * The payment, from eBIZ's own `paymentStatus`:
 *   PAID                         known, paid in full (the detail's
 *                                `paidAmount` when it has one, else gross)
 *   WAITING_FOR_PAYMENT, EXPIRED known, nothing paid
 *   NONE or missing              unknown (`paymentsKnown` null), never
 *                                "unpaid": eBIZ simply does not track it
 */
export function ebizPayment(
  item: Pick<EbizInvoiceListItem, "paymentStatus" | "summary">,
  detail: Pick<EbizInvoiceDetail, "paidAmount"> | null,
): { paymentsKnown: boolean | null; paidAmount: string } {
  switch (item.paymentStatus) {
    case "PAID":
      return {
        paymentsKnown: true,
        paidAmount:
          detail?.paidAmount != null && detail.paidAmount > 0
            ? amount(detail.paidAmount)
            : amount(item.summary.grossAmount),
      };
    case "WAITING_FOR_PAYMENT":
    case "EXPIRED":
      return { paymentsKnown: true, paidAmount: "0.00" };
    default:
      return { paymentsKnown: null, paidAmount: "0.00" };
  }
}

/** Lines in the shape the external detail page reads. */
function lines(detail: EbizInvoiceDetail | null) {
  return (detail?.items ?? []).map((line) => ({
    name: line.name,
    quantity: String(line.quantity),
    unit:
      line.unit === "CUSTOM" && line.customUnit ? line.customUnit : line.unit,
    unitNet: amount(line.netUnitAmount),
    vatRate: line.vat,
    netAmount: amount(line.netAmount),
    vatAmount: amount(line.vatAmount),
    grossAmount: amount(line.grossAmount),
  }));
}

function address(detail: EbizInvoiceDetail | null): string | null {
  const a = detail?.customer?.address;
  if (!a) return null;
  const text = [a.zipCode, a.city, a.address].filter(Boolean).join(" ").trim();
  return text || null;
}

/** The fields eBIZ owns and may change: the list's view of the invoice. */
export function ebizListFields(item: EbizInvoiceListItem) {
  return {
    kindCode: ebizKindCode(item.type),
    documentNumber: item.invoiceNumber,
    issueDate: day(item.issueDate) ?? new Date(`${item.issueDate}T00:00:00Z`),
    fulfillmentDate: day(item.deliveryDate),
    dueDate: day(item.dueDate),
    paymentMethod: item.paymentMethod ?? null,
    currency: item.currencyCode,
    customerName: item.customerName,
    netAmount: amount(item.summary.netAmount),
    vatAmount: amount(item.summary.vatAmount),
    grossAmount: amount(item.summary.grossAmount),
    cancelled: item.cancelled === true,
    externalPaymentStatus: item.paymentStatus ?? null,
  };
}

/**
 * A new row: the list fields plus what only the detail has (lines, address,
 * tax number, order number, paid amount). `detail` may be `null` when it
 * could not be read; the row is still created and the gap is counted.
 */
export function ebizNewRow(
  item: EbizInvoiceListItem,
  detail: EbizInvoiceDetail | null,
  now: Date,
) {
  const payment = ebizPayment(item, detail);
  return {
    source: "EBIZ",
    externalId: String(item.id),
    feedMessageId: `EBIZ:${item.id}`,
    feedReceivedAt: now,
    electronic: true,
    ...ebizListFields(item),
    orderNumber: detail?.orderNumber ?? null,
    customerTaxNumber:
      detail?.customer?.taxNumbers?.find((tax) => tax.taxNumber)?.taxNumber ??
      null,
    customerAddress: address(detail),
    lines: lines(detail),
    payments: [],
    paymentsKnown: payment.paymentsKnown,
    paidAmount: payment.paidAmount,
  };
}

/**
 * HOW THE API PAGES. The spec calls `offset` the page number; measured live
 * it was "50-es limit, offset". Rather than guess, the sync asks for page 0
 * and offset 1 and compares: if offset 1 starts with page 0's second invoice,
 * `offset` counts invoices; otherwise it counts pages.
 */
export function pagingStep(
  firstPage: readonly { id: number }[],
  offsetOne: readonly { id: number }[],
  limit: number,
): number {
  return firstPage.length > 1 &&
    offsetOne.length > 0 &&
    offsetOne[0]!.id === firstPage[1]!.id
    ? limit
    : 1;
}
