/**
 * ONE BANK CREDIT AND OUR INVOICES IT PAYS (card aeddb2c3, slice 3): the Banki átutalások page lists the credits,
 * what their remittance names and whether that pairs automatically; a person pairs the rest by typing the invoice
 * numbers (the same shorthand: `2026/00083,86,85,84`). The server decides again on every write.
 */
export type BankTransferRefusalValue =
  | "NO_REFERENCE"
  | "UNRESOLVED"
  | "OTHER_CURRENCY"
  | "PAYMENTS_UNKNOWN"
  | "DIFFERENT_CUSTOMERS"
  | "AMOUNT_MISMATCH"
  | "ALREADY_PAID";

/** What the invoice numbers decide against the credit. */
export type BankTransferDecisionView =
  | {
      markable: true;
      /** the invoices that get a mark, with the amount written on each */
      marks: { invoiceNumber: string; amount: string }[];
      /** already paid in Számlázz.hu from this credit (its own pairing): not written again */
      paidBefore: string[];
    }
  | {
      markable: false;
      refusal: BankTransferRefusalValue;
      /** the person-readable sentence */
      reason: string;
      detail: string;
    };

export interface BankTransferCreditView {
  id: string;
  /** ÉÉÉÉ-HH-NN: the value date, else the booking date */
  day: string;
  amount: string;
  currency: string;
  narrative: string;
  counterpartyName: string | null;
  decision: BankTransferDecisionView;
  /** invoices this credit already marked paid (BANK_TRANSFER, written) */
  written: string[];
}

export interface BankTransferPairResult {
  /** per invoice: WRITTEN, ALREADY_PAID, ... (the writer's outcome) */
  lines: { invoiceNumber: string; outcome: string }[];
}

/** The refusal in a sentence a person reads on the page. */
export const BANK_TRANSFER_REFUSAL_TEXT: Readonly<
  Record<BankTransferRefusalValue, string>
> = {
  NO_REFERENCE: "Nem találok saját számlaszámot a megadott szövegben.",
  UNRESOLVED:
    "Nem minden számlaszám található meg egyértelműen (hiányzik, sztornózott vagy díjbekérő).",
  OTHER_CURRENCY: "A számlák pénzneme eltér a jóváírásétól.",
  PAYMENTS_UNKNOWN:
    "Egy számla fizetési adata még nem érkezett meg a Számlázz.hu-ból; később próbáld újra.",
  DIFFERENT_CUSTOMERS: "A számlák nem ugyanannak a vevőnek szólnak.",
  AMOUNT_MISMATCH:
    "Az összeg nem egyezik a számlák nyitott összegével, ezért nem írom be.",
  ALREADY_PAID: "Mindegyik számla már ki van fizetve.",
};
