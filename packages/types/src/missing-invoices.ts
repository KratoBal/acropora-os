/**
 * HIÁNYZÓ SZÁMLÁK: a drót-típusok (nautilus, a felület murenáé, 25263). Ez a
 * fájl szeletenként bővül; most a kivonat-feltöltés válasza áll benne.
 */

/** `POST /missing-invoices/bank-statements` válasza. */
export interface BankStatementImportResult {
  importId: string;
  fileName: string;
  /** Az olvasható sorok száma a fájlban. */
  rowCount: number;
  /** Ennyi sor lett új; a többi már korábbi feltöltésből megvolt. */
  createdCount: number;
  skippedCount: number;
  /** Az olvashatatlan sorok (az első tíz), sorszámmal és okkal. */
  rejected: { line: number; reason: string }[];
  rejectedCount: number;
  /** A fájlban szereplő bankszámlák. */
  accounts: { accountNumber: string; currency: string }[];
  /** A fájl könyvelési hónapjai, `ÉÉÉÉ-HH` alakban, növekvően. */
  months: string[];
}

export const MISSING_INVOICE_ITEM_STATES = [
  "FOUND",
  "NOT_MATCHED",
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
  "NO_INVOICE_NEEDED",
] as const;
export type MissingInvoiceItemState =
  (typeof MISSING_INVOICE_ITEM_STATES)[number];

export const MISSING_INVOICE_MONTH_STATUSES = [
  "READY",
  "INCOMPLETE",
  "STATEMENT_MISSING",
  "STATEMENT_PARTIAL",
] as const;
export type MissingInvoiceMonthStatus =
  (typeof MISSING_INVOICE_MONTH_STATUSES)[number];

export const MISSING_INVOICE_CATEGORIES = [
  "INTERNAL_TRANSFER",
  "BANK_FEE",
  "TAX",
  "PAYROLL",
  "LOAN",
  "INSURANCE",
  "CARD_SUBSCRIPTION",
  "FOREIGN_SUPPLIER",
  "DOMESTIC_SUPPLIER",
  "UNCERTAIN",
] as const;
export type MissingInvoiceCategory =
  (typeof MISSING_INVOICE_CATEGORIES)[number];

export const MISSING_INVOICE_TABS = [
  "MISSING",
  "NOT_MATCHED",
  "FOUND",
  "NO_INVOICE_NEEDED",
  "ALL",
] as const;
export type MissingInvoiceTab = (typeof MISSING_INVOICE_TABS)[number];

export type MissingInvoiceDocumentSource =
  "NAV" | "MAILBOX" | "UPLOAD" | "DRIVE" | "SETTLEMENT" | "PREMIUM_NOTICE";

export interface MissingInvoiceMonth {
  /** `ÉÉÉÉ-HH` */
  month: string;
  /** Terhelések, a Nem kell számla nélkül. */
  debitCount: number;
  found: number;
  notMatched: number;
  /** Nincs számla + Nem a cégre szól + Csak díjbekérő. */
  noInvoice: number;
  noInvoiceNeeded: number;
  /** A Nem párosodott és a Nincs számla sorok HUF-összege, tizedes szöveg. */
  missingAmountHuf: string;
  status: MissingInvoiceMonthStatus;
  /** A bankszámlák neve, amelyekhez erre a hónapra nincs kivonat. */
  missingStatementAccounts: string[];
}

export interface MissingInvoiceMonthsResponse {
  company: { name: string; taxNumber: string };
  /** A legújabb elöl. */
  months: MissingInvoiceMonth[];
}

export interface MissingInvoiceItem {
  id: string;
  /** `ÉÉÉÉ-HH-NN` */
  bookingDate: string;
  account: { id: string; name: string };
  partner: string | null;
  narrative: string;
  /** A könyvelt összeg, előjel nélkül, a bankszámla pénznemében. */
  amount: string;
  currency: string;
  original: { amount: string; currency: string } | null;
  category: MissingInvoiceCategory;
  categoryRule: string;
  categoryOverridden: boolean;
  state: MissingInvoiceItemState;
  document: {
    id: string;
    number: string;
    source: MissingInvoiceDocumentSource;
  } | null;
  matchedBy: "RULE" | "MANUAL" | null;
  comment: string | null;
}

export interface MissingInvoiceMonthDetail {
  month: string;
  status: MissingInvoiceMonthStatus;
  accounts: {
    id: string;
    name: string;
    accountNumber: string;
    currency: string;
    hasStatement: boolean;
  }[];
  tiles: {
    found: number;
    notMatched: number;
    noInvoice: number;
    noInvoiceNeeded: number;
  };
  items: MissingInvoiceItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface MissingInvoiceMonthQuery {
  tab?: MissingInvoiceTab;
  q?: string;
  category?: MissingInvoiceCategory;
  accountId?: string;
  page?: number;
  pageSize?: number;
}
