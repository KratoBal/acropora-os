import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentKey } from "../service-assets/document-store/document-store.js";

/** Where the billing module's issue stores the issued PDF (`invoice/<id>/billing-document.pdf`). */
export const ISSUED_PDF = "billing-document.pdf";
/** Where the TIG invoice's issue stores it (`MaintenanceInvoiceDraftService.issue`), from before the billing module. */
export const TIG_ISSUED_PDF = "invoice.pdf";

/**
 * THE ISSUED PDF OF AN OWN ROW, WHICHEVER ISSUE STORED IT. Since #2421 an issued TIG invoice is an own row of the
 * billing module, but its PDF sits under the TIG issue's name: the details page's download and the e-mail's
 * attachment asked for `billing-document.pdf` and found nothing. The row's stored key says which one it is; any other
 * key reads as before.
 */
export function issuedPdfKey(row: {
  id: string;
  pdfStorageKey: string | null;
}): DocumentKey {
  const tig: DocumentKey = {
    owner: "invoice",
    ownerId: row.id,
    documentId: TIG_ISSUED_PDF,
  };
  return row.pdfStorageKey === storageKeyFor(tig)
    ? tig
    : { owner: "invoice", ownerId: row.id, documentId: ISSUED_PDF };
}
