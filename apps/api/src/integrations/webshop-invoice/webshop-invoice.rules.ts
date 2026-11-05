/**
 * MELYIK SZÁMLÁKAT LÁTJA A VENDÉG A RENDELÉSÉHEZ (V1.1; tiszta szabály, a sorokat a tároló adja).
 *
 * A vendég a SAJÁT rendelésének számláját kapja, és csak azt, ami valódi, kiállított számla:
 *  - kimenő (a bejövő a beszállítóké), kiállítva (`ISSUED`), van tárolt PDF-je;
 *  - típusa számla, előlegszámla, végszámla vagy helyesbítő számla (a vevőnek jogilag az utóbbi is számla, amit meg kell kapnia:
 *    barracuda, #2201 review; a díjbekérő, a szállítólevél és a sztornó nem);
 *  - a sztornózott számla kimarad: egy érvénytelenített számla letöltése félrevezetne.
 * A sorrend a kiállítás ideje, a legrégebbi elöl.
 */
export const GUEST_INVOICE_TYPES = [
  "INVOICE",
  "ADVANCE_INVOICE",
  "FINAL_INVOICE",
  "CORRECTION",
] as const;

export interface InvoiceCandidate {
  id: string;
  direction: string;
  status: string;
  documentType: string;
  pdfStorageKey: string | null;
  invoiceNumber: string | null;
  issueDate: Date | null;
}

export interface GuestInvoice {
  id: string;
  invoiceNumber: string | null;
  documentType: (typeof GUEST_INVOICE_TYPES)[number];
  issueDate: string | null;
}

export function guestInvoicesOf(
  candidates: readonly InvoiceCandidate[],
  /** a sztornózott számlák azonosítói (kiállított STORNO sor hivatkozik rájuk) */
  stornoedIds: ReadonlySet<string>,
): GuestInvoice[] {
  return candidates
    .filter(
      (row) =>
        row.direction === "OUTBOUND" &&
        row.status === "ISSUED" &&
        row.pdfStorageKey !== null &&
        (GUEST_INVOICE_TYPES as readonly string[]).includes(row.documentType) &&
        !stornoedIds.has(row.id),
    )
    .sort(
      (a, b) =>
        (a.issueDate?.getTime() ?? 0) - (b.issueDate?.getTime() ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      documentType: row.documentType as GuestInvoice["documentType"],
      issueDate: row.issueDate ? row.issueDate.toISOString() : null,
    }));
}
