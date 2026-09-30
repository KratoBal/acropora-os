import type { SupplierInvoiceImportResult } from "@acropora/types";

import { normalizeVatId } from "../supplier-invoice-import/supplier-invoice-import.common.js";
import type { SupplierPdfAdapter } from "../supplier-invoice-import/supplier-pdf-adapter.js";

/**
 * WHAT AN ARRIVED DOCUMENT OPENS OR JOINS (Várható beérkezések).
 *
 * One expected arrival is one supplier ORDER: the proforma opens it, the
 * invoice arrives to the same one, and the order number ties them together
 * (Aquarioom, measured by nautilus: both documents' first line is
 * "AQUARIOOM Order n° 13858"). Without an order number, the invoice number
 * is the key. The supplier's key is its normalised VAT id, or its name when
 * the document carries none.
 *
 * The order number and the document kind come from the adapter
 * (`orderReference`, `documentKind`, #1235); both are optional, so an adapter
 * that does not give them yields an invoice keyed by its number.
 */

export interface ArrivalIdentity {
  supplierKey: string;
  arrivalKey: string;
  supplierName: string;
  kind: "INVOICE" | "PROFORMA";
  orderReference: string | null;
  invoiceNumber: string | null;
}

export function arrivalIdentity(
  result: SupplierInvoiceImportResult,
): ArrivalIdentity | null {
  const kind = result.documentKind === "PROFORMA" ? "PROFORMA" : "INVOICE";
  const orderReference = result.orderReference?.trim() || null;
  const invoiceNumber = result.invoiceNumber?.trim() || null;
  const supplierName = result.supplier.name?.trim() || "";
  const supplierKey =
    normalizeVatId(result.supplier.vatId) ??
    (supplierName.toLowerCase() || null);

  if (!supplierKey) return null;
  // A proforma's number is not the invoice's: only an order number ties it.
  const arrivalKey = orderReference
    ? `order:${orderReference}`
    : kind === "INVOICE" && invoiceNumber
      ? `invoice:${invoiceNumber}`
      : null;
  if (!arrivalKey) return null;

  return {
    supplierKey,
    arrivalKey,
    supplierName: supplierName || supplierKey,
    kind,
    orderReference,
    invoiceNumber: kind === "INVOICE" ? invoiceNumber : null,
  };
}

/**
 * A document already on the arrival makes the new one a DUPLICATE: the same
 * bytes, or the same kind with the same invoice number (De Jong's finance@
 * reminder attaches the same invoice again, nautilus measured 8 of them).
 */
export function isDuplicateDocument(
  incoming: {
    sha256: string;
    kind: "INVOICE" | "PROFORMA";
    invoiceNumber: string | null;
  },
  existing: readonly {
    sha256: string;
    kind: "INVOICE" | "PROFORMA" | null;
    invoiceNumber: string | null;
  }[],
): boolean {
  return existing.some(
    (document) =>
      document.sha256 === incoming.sha256 ||
      (document.kind === incoming.kind &&
        incoming.invoiceNumber !== null &&
        document.invoiceNumber === incoming.invoiceNumber),
  );
}

/** The senders the PDF adapters name (`SupplierPdfAdapter.senders`, #1235). */
export function adapterSenders(
  adapters: readonly Pick<SupplierPdfAdapter, "senders">[],
): string[] {
  return adapters.flatMap((adapter) => adapter.senders ?? []);
}
