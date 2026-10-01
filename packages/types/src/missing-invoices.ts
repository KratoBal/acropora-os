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
  /**
   * A függő kártyás tételek (az első tíz): a bank még nem könyvelte, dátumuk
   * nincs, a következő kivonatban jönnek. Nem hiba (acrobot 25637).
   */
  pending: {
    line: number;
    partner: string | null;
    amount: string;
    currency: string;
  }[];
  pendingCount: number;
  /** A fájlban szereplő bankszámlák. */
  accounts: { accountNumber: string; currency: string }[];
  /** A fájl könyvelési hónapjai, `ÉÉÉÉ-HH` alakban, növekvően. */
  months: string[];
}

export const MISSING_INVOICE_ITEM_STATES = [
  "FOUND",
  /** Párosítva, de csak NAV-adat van: az eredeti (PDF vagy papír) kell. */
  "ORIGINAL_MISSING",
  "NOT_MATCHED",
  "NO_INVOICE",
  "NOT_COMPANY",
  "PROFORMA_ONLY",
  /**
   * Ugyanaz a számla (azonos fájl vagy azonos számlaszám) két terheléshez is
   * párosítva: valószínűleg kétszer fizettük (acrobot 25636). Egyik sem Megvan.
   */
  "DOUBLE_PAID",
  "NO_INVOICE_NEEDED",
] as const;
export type MissingInvoiceItemState =
  (typeof MISSING_INVOICE_ITEM_STATES)[number];

/**
 * AZ ÁLLAPOT FELIRATA: a felület és a hiánylista (xlsx) ugyanazt a szót
 * mutatja, ezért egy helyen áll.
 */
export const MISSING_INVOICE_STATE_LABELS: Readonly<
  Record<MissingInvoiceItemState, string>
> = {
  FOUND: "Megvan",
  ORIGINAL_MISSING: "Eredeti hiányzik",
  NOT_MATCHED: "Nem párosodott",
  NO_INVOICE: "Nincs számla",
  NOT_COMPANY: "Nem a cégre szól",
  PROFORMA_ONLY: "Csak díjbekérő",
  DOUBLE_PAID: "Kétszer fizetett számla",
  NO_INVOICE_NEEDED: "Nem kell számla",
};

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
  "CASH_WITHDRAWAL",
  "CUSTOMER_REFUND",
  "INSURANCE",
  "CARD_SUBSCRIPTION",
  "FOREIGN_SUPPLIER",
  "DOMESTIC_SUPPLIER",
  "UNCERTAIN",
] as const;
export type MissingInvoiceCategory =
  (typeof MISSING_INVOICE_CATEGORIES)[number];

/** A kategória felirata, ugyanúgy közösen (lásd az állapotét). */
export const MISSING_INVOICE_CATEGORY_LABELS: Readonly<
  Record<MissingInvoiceCategory, string>
> = {
  DOMESTIC_SUPPLIER: "Magyar szállító",
  FOREIGN_SUPPLIER: "Külföldi szállító",
  CARD_SUBSCRIPTION: "Kártyás előfizetés",
  INSURANCE: "Biztosítás",
  UNCERTAIN: "Bizonytalan",
  TAX: "Adó",
  PAYROLL: "Munkabér",
  BANK_FEE: "Banki díj",
  INTERNAL_TRANSFER: "Belső átvezetés",
  LOAN: "Kölcsön",
  CASH_WITHDRAWAL: "Készpénzfelvétel",
  CUSTOMER_REFUND: "Vevői visszatérítés",
};

export const MISSING_INVOICE_TABS = [
  "MISSING",
  "NOT_MATCHED",
  "FOUND",
  "NO_INVOICE_NEEDED",
  "ALL",
] as const;
export type MissingInvoiceTab = (typeof MISSING_INVOICE_TABS)[number];

export type MissingInvoiceDocumentSource =
  | "NAV"
  | "MAILBOX"
  | "UPLOAD"
  | "DRIVE"
  | "SETTLEMENT"
  | "PREMIUM_NOTICE"
  /** A Számlázz.hu bejövő számla-továbbítása (acrobot 25686). */
  | "SZAMLAZZ";

export interface MissingInvoiceMonth {
  /** `ÉÉÉÉ-HH` */
  month: string;
  /** Terhelések, a Nem kell számla nélkül. */
  debitCount: number;
  found: number;
  /** Eredeti hiányzik: a számla ismert, az eredeti PDF vagy a papír kell. */
  originalMissing: number;
  notMatched: number;
  /** Nincs számla + Nem a cégre szól + Csak díjbekérő. */
  noInvoice: number;
  noInvoiceNeeded: number;
  /**
   * A Nem párosodott és a Nincs számla sorok HUF-összege, tizedes szöveg. Az
   * Eredeti hiányzik NEM számít bele: ott a számla ismert, csak az eredeti kell.
   */
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
  /**
   * MINDEN párosított számla száma (a `document` csak az első). Több számla egy
   * utalásban, ha a közlemény megnevezi őket (acrobot 25610).
   */
  documentNumbers: string[];
  /**
   * A közlemény által megnevezett, de hiányzó számlák NÉV SZERINT (Balázs: „ki
   * kellene írni melyik hiányzik”): aminek nincs eredetije, vagy semmilyen
   * dokumentuma. Ha nem üres, a tétel nem Megvan.
   */
  missingNumbers: string[];
  /**
   * A terhelés mínusz a párosított számlák összege, ha a kerekítési tűrésen túl
   * eltér (előjeles: negatív, ha a számlák többet tesznek ki). A párosítás áll.
   */
  amountDifference: { amount: string; currency: string } | null;
  comment: string | null;
  /** Kézzel jelölve: az eredeti papíron megvan (acrobot 25322). */
  paperOriginal: boolean;
}

/** A „Mit kell tenni” szöveg kulcsa, az állapotból. */
export const MISSING_INVOICE_ACTIONS = [
  "NONE",
  "PROVIDE_ORIGINAL",
  "PAIR_OR_UPLOAD",
  "REQUEST_INVOICE",
  "REQUEST_REISSUE_TO_COMPANY",
  "REQUEST_FINAL_INVOICE",
  "CHECK_DOUBLE_PAYMENT",
  /** Biztosításnál: díjértesítő (vagy a biztosító számlája) kell (barracuda, 2. csoport). */
  "PROVIDE_PREMIUM_NOTICE",
] as const;
export type MissingInvoiceAction = (typeof MISSING_INVOICE_ACTIONS)[number];

export interface MissingInvoiceCandidate {
  documentId: string;
  number: string;
  /** `ÉÉÉÉ-HH-NN` */
  date: string;
  /** `null`, ahol a forrás nem ad bruttót (hazai postafiók-számla). */
  gross: string | null;
  currency: string;
  source: MissingInvoiceDocumentSource;
  payee: "COMPANY" | "NOT_COMPANY" | "UNKNOWN";
  hasOriginal: boolean;
}

/**
 * A párosított számla, amelynek vevőjét kézzel lehet (vagy kellett) jelölni:
 * a szövegréteg nélküli PDF vevője UNKNOWN (acrobot 25633).
 */
export interface MissingInvoicePayeeDocument {
  documentId: string;
  number: string;
  payee: "COMPANY" | "NOT_COMPANY" | "UNKNOWN";
  /** Kézzel jelölték (és ezért kézzel át is jelölhető). */
  marked: boolean;
}

export interface MissingInvoiceItemDetail extends MissingInvoiceItem {
  /** A partner ablakba eső, még nem párosított számlái (a drawer jelöltjei). */
  candidates: MissingInvoiceCandidate[];
  /** A párosított számlák közül a kézzel jelölhető vevőjűek. */
  payeeDocuments: MissingInvoicePayeeDocument[];
  action: MissingInvoiceAction;
  /** A „Hiányzó számlák” Drive-mappa, ha a szerveren be van állítva. */
  driveFolderUrl: string | null;
  /**
   * A többi terhelés, amelyhez ugyanez a számla párosítva van (Kétszer
   * fizetett számla, acrobot 25636).
   */
  doublePaidWith: {
    id: string;
    bookingDate: string;
    amount: string;
    currency: string;
  }[];
}

export interface MissingInvoiceMatchInput {
  documentId: string;
}
export interface MissingInvoiceCommentInput {
  comment: string | null;
}
export interface MissingInvoiceCategoryInput {
  /** `null`: a szabály dönt. */
  category: MissingInvoiceCategory | null;
}
export interface MissingInvoicePaperOriginalInput {
  marked: boolean;
}
export interface MissingInvoicePayeeInput {
  payee: "COMPANY" | "NOT_COMPANY";
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
    originalMissing: number;
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

/**
 * A Jev párosítási javaslata egy terheléshez (`GET .../items/:id/jev-suggestion`).
 * Csak javaslat: az elfogadás a kézi párosítás (`POST .../items/:id/match`).
 */
export interface MissingInvoiceJevSuggestion {
  /** `false`: ki van kapcsolva vagy leállt; a drawer ne kérdezzen többet. */
  enabled: boolean;
  /** A javasolt jelölt `documentId`-je, CSAK látható javaslatnál; különben `null`. */
  documentId: string | null;
  /** A Jev bizonyossága (0..1), csak látható javaslatnál. */
  confidence: number | null;
}

/**
 * A JEV JAVASLATA A BEGYŰJTÉSBŐL (levél-válogatás terv, 4. szelet; acrobot
 * 25803): egy illesztő nélküli levél PDF-je, amit a Jev bejövő számlának látott.
 * Amíg ember nem fogadja el, NEM jelölt a Hiányzó számlák között.
 */
export interface InvoiceCollectionSuggestion {
  documentId: string;
  fileName: string;
  sender: string | null;
  subject: string | null;
  receivedAt: string | null;
  /** A Jev bizonyossága, 0..1, két tizedesre kerekítve. */
  confidence: number | null;
  decisionRunId: string | null;
  /** Az általános olvasó eredménye, ha volt (számlaszám, szállító, bruttó). */
  invoiceNumber: string | null;
  supplierName: string | null;
  gross: string | null;
  currency: string | null;
  createdAt: string;
}

export interface InvoiceCollectionSuggestionsResponse {
  items: InvoiceCollectionSuggestion[];
}

/** A javaslat sorsa: elfogadva jelölt lesz, elvetve a dokumentum törlődik. */
export type InvoiceCollectionSuggestionDecision = "ACCEPT" | "REJECT";
