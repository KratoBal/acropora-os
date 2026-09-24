/**
 * A KARBANTARTÁSI PISZKOZAT-SZÁMLA ÖSSZEGZÉSE (ADR-014, 4. szelet).
 *
 * A pénzösszegek STRING-KÉNT utaznak, a UNAS-tükör `UnasOrderInvoiceSummary`
 * mintáját követve (`unas-order-sync.types.ts` toInvoiceSummary): a szerver
 * oldali `Prisma.Decimal` nem JSON-biztos szám, a string viszont pontosan
 * hordozza, amit a kijelzés használ.
 */
export interface MaintenanceInvoiceSummary {
  id: string;
  status: "DRAFT" | "ISSUED";
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  createdAt: string;
}
