import { Prisma } from "@acropora/database";

/**
 * ONE OWN INVOICE NUMBER, ONE ROW (acrobot 26208; Balázs 2026-10-05 09:05 UTC:
 * the October outgoing list showed four invoices twice, once from Számlázz.hu
 * and once from eBIZ).
 *
 * Both sources bring our own outgoing invoices, and an invoice number is unique
 * for its issuer, so the number is the identity. The row belongs to Számlázz.hu
 * whenever Számlázz.hu knows the invoice (`source` SZAMLAZZ: its payments, its
 * paid-marks, its versions); eBIZ only adds what Számlázz.hu has not got, the
 * PDF, and records its id in `ebizExternalId` so its next sync finds the row.
 *
 * The order of arrival does not matter:
 *   Számlázz.hu first   eBIZ links its id to that row and stores the PDF on it
 *                       (`EbizSyncService`, `szamlazzTwins` + `linkEbiz`);
 *   eBIZ first          Számlázz.hu takes the eBIZ row over: same row id, so
 *                       the PDF stored under it stays (`takeOverEbizRow`).
 */

/** The number as compared: case and spacing do not make another invoice. */
export const invoiceNumberKey = (number: string): string =>
  number.replace(/\s/g, "").toUpperCase();

/**
 * Számlázz.hu takes over an eBIZ row: the row keeps its id, its PDF and its
 * creation time; everything else is Számlázz.hu's. eBIZ's own payment status
 * is dropped, because the payment now comes from Számlázz.hu.
 */
export function takeOverEbizRow(
  ebizRow: { externalId: string },
  szamlazz: { externalId: string } & Record<string, unknown>,
): Prisma.ExternalBillingDocumentUpdateInput {
  return {
    ...(szamlazz as Prisma.ExternalBillingDocumentUpdateInput),
    source: "SZAMLAZZ",
    externalId: szamlazz.externalId,
    ebizExternalId: ebizRow.externalId,
    externalPaymentStatus: null,
  };
}

/**
 * The fields of a Számlázz.hu row that move onto the row it is merged into:
 * all but the row's identity, its PDF and the eBIZ link.
 */
export function szamlazzFieldsOf(
  row: Record<string, unknown>,
): { externalId: string } & Record<string, unknown> {
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    pdfStorageKey: _pdfStorageKey,
    pdfMissingReason: _pdfMissingReason,
    ebizExternalId: _ebizExternalId,
    externalPaymentStatus: _externalPaymentStatus,
    source: _source,
    ...rest
  } = row;
  return rest as { externalId: string } & Record<string, unknown>;
}
