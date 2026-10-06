import type { DecimalText } from "./billing-document-amounts.js";
import type { InvoiceFormat } from "./billing-document.js";
import type { BillingPaymentSource } from "./billing-document-read.js";

/**
 * A SZÁMLÁZÁS „BEJÖVŐ SZÁMLÁK” NÉZETE (Balázs újraterv-promptja, acrobot 25869):
 * a Számlázz.hu adatkapcsolatából érkezett beszállítói számlák, csak olvasásra.
 */

/**
 * A KIFIZETÉSI ÁLLAPOT, a Számlázz.hu kifizetés-adatából SZÁRMAZTATVA (a
 * kifizetések összege a bruttóhoz mérve). UNKNOWN: a Számlázz.hu nem küldött
 * kifizetés-adatot (az elem opcionális), ez NEM azonos a „nem fizetett”-tel.
 */
export const INCOMING_PAYMENT_STATES = [
  "PAID",
  "PARTIAL",
  "UNPAID",
  "UNKNOWN",
] as const;
export type IncomingPaymentState = (typeof INCOMING_PAYMENT_STATES)[number];

export const INCOMING_PAYMENT_STATE_LABELS: Readonly<
  Record<IncomingPaymentState, string>
> = {
  PAID: "Fizetve",
  PARTIAL: "Részben fizetve",
  UNPAID: "Nincs fizetve",
  UNKNOWN: "Nincs adat",
};

/**
 * A BANKI PÁROSÍTÁS, a Hiányzó számlák meglévő számításából (új logika nélkül).
 * NOT_TO_PAIR csak két esetben (acrobot 25879, Balázs 09-30-i döntése): a számla
 * nem a cégre szól, vagy díjbekérő.
 */
export const INCOMING_BANK_MATCH_STATES = [
  "PAIRED",
  "UNPAIRED",
  "NOT_TO_PAIR",
] as const;
export type IncomingBankMatchState =
  (typeof INCOMING_BANK_MATCH_STATES)[number];

export const INCOMING_BANK_MATCH_LABELS: Readonly<
  Record<IncomingBankMatchState, string>
> = {
  PAIRED: "Bankkal párosodott",
  UNPAIRED: "Nincs banki pár",
  NOT_TO_PAIR: "Nem párosítandó",
};

/** A „nem párosítandó” oka, a felületen kiírva. */
export const INCOMING_NOT_TO_PAIR_REASON_LABELS: Readonly<
  Record<"NOT_COMPANY" | "PROFORMA", string>
> = {
  NOT_COMPANY: "A számla nem a cégre szól.",
  PROFORMA: "Díjbekérő, nem számla: nem kerül banki párosításra.",
};

export interface IncomingBankMatch {
  state: IncomingBankMatchState;
  /** NOT_TO_PAIR oka. */
  reason: "NOT_COMPANY" | "PROFORMA" | null;
  /** A párosított terhelések (egy számlát több terhelés is fizethet). */
  debits: { bookingDate: string; amount: DecimalText; currency: string }[];
}

/** A dátum-szűrő alapja (a prompt 6. pontja): kelt vagy teljesítés. */
export type IncomingDateBasis = "ISSUE" | "FULFILLMENT";

/** `GET /billing/incoming-documents` lekérdezése. */
export interface IncomingDocumentListQuery {
  page?: number;
  pageSize?: number;
  /** Szállító neve vagy adószáma (részleges egyezés). */
  q?: string;
  /** `YYYY-MM-DD`, mindkét vég benne. */
  from?: string;
  to?: string;
  dateBasis?: IncomingDateBasis;
  paymentState?: IncomingPaymentState;
  /** A Számlázz.hu típuskódja (SZ, SS, JS, HS, ES, VS, D, SL). */
  kindCode?: string;
  currency?: string;
  bankMatch?: IncomingBankMatchState;
}

export type IncomingDocumentOrigin = "SZAMLAZZ" | "MAILBOX";

export interface IncomingDocumentListItem {
  id: string;
  /**
   * HONNAN ISMERJÜK (kártya 096607af, acrobot 26716): `SZAMLAZZ` a bejövő feed
   * sora; `MAILBOX` a feedben NEM szereplő, csak postafiókból (Drive-ról,
   * feltöltésből) ismert számla, amit a banki párosítás teljesen fizetettnek
   * talált (külföldi kiállító nem jelent a NAV-nak, így a Számlázz.hu sem
   * kapja meg). A postafiókos sornak nincs feed-adatlapja, és nincs nettó,
   * ÁFA és formátum adata.
   */
  origin: IncomingDocumentOrigin;
  documentNumber: string;
  kindCode: string;
  kindLabel: string;
  /** A postafiókos sornál `null`: a formátumot a feed adja. */
  invoiceFormat: InvoiceFormat | null;
  cancelled: boolean;
  supplierName: string;
  supplierTaxNumber: string | null;
  issueDate: string;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  exchangeRate: DecimalText | null;
  /** A postafiókos sornál `null`: a nettó és az ÁFA a feed adata. */
  netAmount: DecimalText | null;
  vatAmount: DecimalText | null;
  /** `null`, ha a postafiókos rekord bruttó nélküli (akkor a fizetett összeg a terhelésé). */
  grossAmount: DecimalText | null;
  /**
   * A KIFIZETETTSÉG (acrobot 25988): ahol a Számlázz.hu kifizetést küldött, az
   * nyer (`SZAMLAZZ`); ahol nem, de a Hiányzó számlák a számlát banki
   * terheléshez párosította, NÁLUNK fizetett (`BANK_PAIRING`). A Számlázz.hu-ba
   * nem írunk.
   */
  paymentState: IncomingPaymentState;
  paidAmount: DecimalText;
  lastPaymentDate: string | null;
  paymentSource: BillingPaymentSource | null;
  /**
   * ELTÉRÉS: a Számlázz.hu részben fizetettnek mondja, a banki párosítás
   * teljesnek. Az állapot a Számlázz.hu-é marad, a jelölés ezt mutatja.
   */
  paymentConflict: boolean;
  bankMatch: IncomingBankMatch;
  /**
   * Letölthető-e a számla PDF-je: a Számlázz.hu küldte, vagy a begyűjtés hozta
   * (számlaszám és szállítói adószám-törzs szerint párosítva).
   */
  hasPdf: boolean;
}

export interface IncomingDocumentListResponse {
  items: IncomingDocumentListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  /** A szűrők választéka a meglévő sorokból (típus, pénznem). */
  facets: {
    kindCodes: { code: string; label: string }[];
    currencies: string[];
  };
}

export interface IncomingDocumentLine {
  name: string;
  quantity: DecimalText;
  unit: string;
  unitNet: DecimalText;
  vatRate: string;
  netAmount: DecimalText;
  vatAmount: DecimalText;
  grossAmount: DecimalText;
}

export interface IncomingDocumentDetail extends IncomingDocumentListItem {
  /** Adatlapja csak a feed sorának van: ott a formátum és az összegek megvannak. */
  origin: "SZAMLAZZ";
  invoiceFormat: InvoiceFormat;
  netAmount: DecimalText;
  vatAmount: DecimalText;
  grossAmount: DecimalText;
  exchangeBank: string | null;
  supplier: {
    name: string;
    address: string | null;
    taxNumber: string | null;
    euTaxNumber: string | null;
    bankAccount: string | null;
  };
  buyer: { name: string; taxNumber: string | null };
  lines: IncomingDocumentLine[];
  vatSummary: {
    vatRate: string;
    netAmount: DecimalText;
    vatAmount: DecimalText;
    grossAmount: DecimalText;
  }[];
  paymentsKnown: boolean;
  payments: {
    date: string;
    title: string;
    amount: DecimalText;
    note: string | null;
  }[];
  note: string | null;
  orderNumber: string | null;
  referencedInvoiceNumber: string | null;
  referencedProformaNumber: string | null;
  versionCount: number;
  receivedAt: string;
}

/**
 * `GET /billing/receipts` (a C szeletig): hány nyugta-üzenet érkezett. A sorok
 * mezőit az első valódi köteg auditja után képezzük le; addig nem találunk ki
 * mezőt (a prompt 10-14. pontja).
 */
export interface ReceiptsResponse {
  received: number;
  items: never[];
}
