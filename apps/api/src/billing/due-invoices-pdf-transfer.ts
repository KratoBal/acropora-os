import type { IncomingBillingDocument } from "@acropora/database";

import {
  readPaymentMethods,
  type PaymentMethodDeps,
} from "./due-invoices-payment-method.js";

/**
 * A SZÁMLA SAJÁT PDF-JE ERŐSEBB A SZÁLLÍTÓ MÚLTJÁNÁL (acrobot 58842, éles mérés 2026-11-20): a Magyar Telekom és a Vízművek számláinak PDF-je „Banki átutalás”-t ír, a banki előzmény viszont kártyásnak
 * mutatta őket. A „valószínűleg nem utalandó” szakaszba tehát nem kerülhet olyan sor, amelynek PDF-je átutalást mond: marad a főlistán, az előzménytől függetlenül.
 *
 * KONZERVATÍV OLDALRA ESIK: az `UTALAS` ítélet ÉS az `ELTERO` (két PDF más-mást mond) is kiveszi a sort a szakaszból. Az olvashatatlan, a mező nélküli és a más módú PDF nem dönt, azokon az előzmény marad
 * (a PDF-olvasás hibája nem húzhat vissza és nem ejthet ki semmit magától). Ha a PDF-ek betöltése magában hibázik, MINDEN jelölt a főlistán marad: egy olvasási hiba nem küldhet utalandó tételt a „nem utalandók” közé.
 *
 * Csak a JELÖLTEKET olvassuk (a kártyás múltú, fizetési mód nélküli sorokat), nem az egész listát: a szakasz ma egy kézen megszámolható sor.
 */
export async function withoutPdfTransfer(input: {
  evidence: ReadonlyMap<string, { cardInvoices: number }>;
  rows: readonly IncomingBillingDocument[];
  pdfIdsOf: (row: IncomingBillingDocument) => readonly string[];
  content: PaymentMethodDeps["content"];
  lines: PaymentMethodDeps["lines"];
}): Promise<ReadonlyMap<string, { cardInvoices: number }>> {
  const candidates = input.rows.filter((row) => input.evidence.has(row.id));
  if (candidates.length === 0) return input.evidence;
  let verdicts;
  try {
    verdicts = await readPaymentMethods({
      targets: async () =>
        candidates.map((row) => ({
          id: row.id,
          supplierName: row.supplierName,
          documentNumber: row.documentNumber,
          pdfIds: input.pdfIdsOf(row),
        })),
      content: input.content,
      lines: input.lines,
    });
  } catch {
    return new Map();
  }
  const keepOut = new Set(
    verdicts
      .filter((v) => v.verdict === "UTALAS" || v.verdict === "ELTERO")
      .map((v) => v.id),
  );
  return new Map([...input.evidence].filter(([id]) => !keepOut.has(id)));
}
