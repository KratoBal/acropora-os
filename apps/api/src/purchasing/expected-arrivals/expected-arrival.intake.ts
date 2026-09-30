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
 * What an invoice SAYS, for telling a re-sent copy from a corrected one: the
 * header figures and every line, not the bytes. A reminder re-attaches the
 * same invoice (De Jong's finance@, nautilus measured 8), possibly as a new
 * file; a corrected invoice keeps its number and changes a line (Marine
 * Aquatics 32600434, 2026-06-18: the "UPDATED INVOICE" 15 minutes later has
 * one more line, 180 -> 254 EUR).
 */
export function documentContent(
  result: SupplierInvoiceImportResult | null | undefined,
): string {
  if (!result) return "";
  return JSON.stringify([
    result.invoiceDate,
    result.currency,
    result.netTotal,
    result.lines.map((line) => [
      line.supplierSku,
      line.description,
      line.quantity,
      line.unitNet,
      line.discountPercent,
      line.lineNet,
    ]),
  ]);
}

export interface PlacedDocument {
  sha256: string;
  kind: "INVOICE" | "PROFORMA" | null;
  invoiceNumber: string | null;
  /** `documentContent` of its reading. */
  content: string;
  /** When the mail arrived: the later mail is the newer document. */
  receivedAt: Date;
}

/**
 * - READ: a new document on the arrival; `supersedes` lists the earlier READ
 *   documents it replaces (by their index in `existing`).
 * - DUPLICATE: the same bytes, or the same kind, number and content, as ANY
 *   version already kept: a reminder that re-attaches the original after its
 *   correction is a copy, not a newer version.
 * - SUPERSEDED: a corrected version of it is already on the arrival, from a
 *   LATER mail. The mailbox lists the newest mail first, so a correction is
 *   often read before its original: the order of reading decides nothing.
 * - LATE_CORRECTION: a different version of an invoice whose arrival is no
 *   longer open (booked): it replaces nothing, the list shows it.
 */
export type DocumentPlacement =
  | { status: "READ"; supersedes: number[] }
  | { status: "DUPLICATE" | "SUPERSEDED" | "LATE_CORRECTION" };

/**
 * Where an arrived document goes (acrobot's decision, 2026-09-30 10:42): an
 * invoice with the same number and DIFFERENT content replaces the earlier
 * one while the arrival is open; on a booked arrival it replaces nothing and
 * is flagged. The same content is still a duplicate.
 */
export function placeDocument(
  incoming: PlacedDocument,
  existing: readonly PlacedDocument[],
  arrivalOpen: boolean,
): DocumentPlacement {
  const sameNumber = (document: PlacedDocument) =>
    document.kind === incoming.kind &&
    incoming.invoiceNumber !== null &&
    document.invoiceNumber === incoming.invoiceNumber;
  if (
    existing.some(
      (document) =>
        document.sha256 === incoming.sha256 ||
        (sameNumber(document) && document.content === incoming.content),
    )
  )
    return { status: "DUPLICATE" };

  // every kept version counts; replacing an already replaced one is a no-op
  const versions = existing
    .map((document, index) => ({ document, index }))
    .filter(({ document }) => sameNumber(document));
  if (!arrivalOpen)
    return versions.length > 0
      ? { status: "LATE_CORRECTION" }
      : { status: "DUPLICATE" };
  if (
    versions.some(
      ({ document }) =>
        document.receivedAt.getTime() > incoming.receivedAt.getTime(),
    )
  )
    return { status: "SUPERSEDED" };
  return { status: "READ", supersedes: versions.map(({ index }) => index) };
}

/** The senders the PDF adapters name (`SupplierPdfAdapter.senders`, #1235). */
export function adapterSenders(
  adapters: readonly Pick<SupplierPdfAdapter, "senders">[],
): string[] {
  return adapters.flatMap((adapter) => adapter.senders ?? []);
}
