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
  | "ALREADY_PAID"
  | "PAID_EARLIER"
  | "PROFORMA"
  | "REFUNDED"
  | "CREDIT_USED"
  | "OTHER_SYSTEM"
  | "OWN_ACCOUNT"
  | "CARD_SETTLEMENT"
  | "PAYMENT_PROVIDER";

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
      /** ALREADY_PAID, but another credit names the same invoice too: one of them may be a double payment */
      possibleDouble?: boolean;
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
  ALREADY_PAID:
    "A Számlázz.hu ezt az utalást már a számlára könyvelte, nincs teendő.",
  PAID_EARLIER:
    "A számla már korábban ki lett fizetve, ez a jóváírás nem az a kifizetés: lehet, hogy kétszer fizették. Nézd meg, és ha igen, utald vissza.",
  PROFORMA:
    "Díjbekérő kifizetése: a számlát a Számlázz.hu automatikusan állítja ki (Autokassza), ezen a lapon nincs mit beírni. Kifizetett számla még nincs hozzá: ha nem jelenik meg, nézd meg a Számlázz.hu-ban.",
  REFUNDED:
    "A számlát sztornózták, és az utalt összeget visszautalták: nincs teendő, a Számlázz.hu-ba nem írunk.",
  CREDIT_USED:
    "Ezt a jóváírást már más számla kifizetéseként beírtuk; egy utalás pénze nem zárhat le két számlát.",
  OTHER_SYSTEM:
    "Ez eBIZ-számla (EINV): a kifizetése nem a Számlázz.hu-ba íródik, ezen a lapon nincs mit beírni.",
  OWN_ACCOUNT:
    "A saját cég nevén érkezett jóváírás (átvezetés, devizaváltás): nem ügyfélfizetés, nincs mit párosítani.",
  CARD_SETTLEMENT:
    "Bankkártya-elfogadói elszámolás (OTP): összesített jóváírás, nem egy számla kifizetése, ezen a lapon nincs mit párosítani.",
  PAYMENT_PROVIDER:
    "SimplePay-elszámolás: összesített jóváírás, a SimplePay saját elszámolási útján rendeződik, ezen a lapon nincs mit párosítani.",
};

/** ALREADY_PAID with a second credit naming the same invoice: the sentence that replaces the plain one. */
export const BANK_TRANSFER_POSSIBLE_DOUBLE_TEXT =
  "A Számlázz.hu ezt az utalást már a számlára könyvelte, de egy másik jóváírás is ugyanezt a számlát nevezi meg: lehet, hogy kétszer fizették. Nézd meg a két jóváírást.";

/**
 * The credits that need nobody (the second survey, 2026-11-18, Luca's three rows): the calm badge a row carries instead of
 * "Kézi párosítás kell". Already paid and refunded are done (green), a díjbekérő waits for Számlázz.hu's own invoicing and its paid invoice (amber: nothing to write, but a person sees it if the invoice does not come).
 */
export const BANK_TRANSFER_SETTLED_BADGE: Readonly<
  Partial<
    Record<
      BankTransferRefusalValue,
      { label: string; variant: "success" | "grey" | "amber" }
    >
  >
> = {
  ALREADY_PAID: { label: "Rendben: a Számlázz.hu beírta", variant: "success" },
  REFUNDED: { label: "Visszafizetve", variant: "success" },
  PROFORMA: { label: "Díjbekérő: számlára vár", variant: "amber" },
};

/**
 * The credits that are not an invoice's payment (the survey of 2026-11-18): the badge a row carries instead of "Kézi párosítás
 * kell". A refusal without an entry here (no reference, unresolved, already paid, used) is a case a person may still decide.
 */
export const BANK_TRANSFER_NOT_A_PAYMENT_LABEL: Readonly<
  Partial<Record<BankTransferRefusalValue, string>>
> = {
  OTHER_SYSTEM: "Más rendszer (eBIZ)",
  OWN_ACCOUNT: "Saját számla",
  CARD_SETTLEMENT: "Kártya-elszámolás",
  PAYMENT_PROVIDER: "SimplePay-elszámolás",
};
