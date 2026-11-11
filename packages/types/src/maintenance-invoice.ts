import type {
  WebshopInvoiceConfirmation,
  WebshopInvoiceIssueResult,
} from "./billing-issue-summary.js";

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
  /**
   * `ISSUING`: a valódi kiállítás elindult, és a kimenete nem ismert (hálózati
   * hiba vagy időtúllépés). Kézi ellenőrzést kér a Számlázz.hu-n; a panel nem
   * kínál rá újabb kiállítást.
   */
  status: "DRAFT" | "ISSUING" | "ISSUED";
  currency: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  createdAt: string;
  /** A Számlázz.hu számlaszáma, csak `ISSUED` állapotban. */
  invoiceNumber?: string;
  /** A kiállítás ideje (ISO), csak `ISSUED` állapotban. */
  issuedAt?: string;
  /**
   * Be van-e kapcsolva a valódi kiállítás ezen a szerveren
   * (`MAINTENANCE_INVOICE_ISSUE_ENABLED`). Alapból NEM: kikapcsolva a panel a
   * gombot tiltva mutatja, és a szerver a kérést Számlázz.hu-hívás nélkül
   * elutasítja.
   */
  issueEnabled: boolean;
  /** `ISSUING` állapotban: mi történt, amiért kézi ellenőrzés kell. */
  issueNote?: string;
}

/**
 * THE TIG INVOICE'S CONFIRMATION (card 7ba97e0d, S3): the same as the webshop's, the three dates, the digest of the shown
 * values and "Elküldöm e-mailben" (Balázs 2026-11-11 11:20 UTC: checked, the invoice goes to the address the window
 * shows, the TIG invoice included).
 */
export type MaintenanceInvoiceConfirmation = WebshopInvoiceConfirmation;

/** What the TIG invoice's issue answers: the invoice, and what happened to the letter (null: none was asked). */
export interface MaintenanceInvoiceIssueResult {
  invoice: MaintenanceInvoiceSummary;
  mail: WebshopInvoiceIssueResult<unknown>["mail"];
}
