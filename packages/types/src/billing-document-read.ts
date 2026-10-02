import type {
  BillingDocumentStatus,
  BillingDocumentType,
  BillingEmailStatus,
  InvoiceFormat,
} from "./billing-document.js";
import type { DecimalText } from "./billing-document-amounts.js";
import type { BillingPaymentState } from "./billing-payment-state.js";

/**
 * A SZÁMLÁZÁS OLVASÓ OLDALA DRÓTON: a lista, a részletek bővítése és a
 * kiküldés bemenete (Számlázás v0.1). A szerződés:
 * `agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md`.
 * A végpontok nautilusé, a felület murenáé; ez a fájl az, amire mindkettő köt,
 * hogy az alakot ne kelljen kétszer leírni.
 */

/** A lista lapmérete: alapértelmezés és felső határ (szerződés, lista). */
export const BILLING_DOCUMENT_LIST_PAGE_SIZE = {
  default: 25,
  max: 100,
} as const;

/** `GET /billing/documents` lekérdezés-paraméterei, már értelmezve. */
export interface BillingDocumentListQuery {
  /** 1-től; alapértelmezés 1. */
  page?: number;
  /** 1..100; alapértelmezés 25. */
  pageSize?: number;
  /**
   * Bizonylatszám, vevő neve, hivatkozás vagy belső azonosító; részleges
   * egyezés, a kis- és nagybetű mindegy.
   */
  q?: string;
  documentType?: BillingDocumentType;
  invoiceFormat?: InvoiceFormat;
  status?: BillingDocumentStatus;
  emailStatus?: BillingEmailStatus;
  /**
   * Honnan jön a bizonylat: a mieink (OWN), a Számlázz.hu-ból kapott külsők
   * (EXTERNAL); hiányzó: mind (Balázs szűrője, acrobot 25812).
   */
  origin?: BillingDocumentOrigin;
}

/**
 * A BIZONYLAT EREDETE. A külső a Számlázz.hu-ból kapott kimenő számla (egy
 * másik számlázóban készült, a Számlázz.hu csak továbbította): csak olvasható,
 * PDF nincs hozzá (acrobot 25812).
 */
export const BILLING_DOCUMENT_ORIGINS = ["OWN", "EXTERNAL"] as const;
export type BillingDocumentOrigin = (typeof BILLING_DOCUMENT_ORIGINS)[number];

/**
 * A sor kattintásának célja (brief 24. pont): vázlatnál a szerkesztő, minden
 * más állapotban a részletek.
 */
export type BillingDocumentListTarget =
  | "EDITOR"
  | "DETAIL"
  /** A külső bizonylat csak olvasható adatlapja (acrobot 25812). */
  | "EXTERNAL_DETAIL";

export interface BillingDocumentListItem {
  /** Az `Invoice.id`, a megnyitás kulcsa. */
  id: string;
  documentType: BillingDocumentType;
  /** `null`, ahol a formátum nem értelmezett (a cellában "—"). */
  invoiceFormat: InvoiceFormat | null;
  /** Vázlatnál `null`. */
  documentNumber: string | null;
  /** Kiállított sornál a vevő-pillanatképből, vázlatnál a partner mai nevéből. */
  customerName: string;
  /** `YYYY-MM-DD`; vázlatnál `null`. */
  issueDate: string | null;
  /** `YYYY-MM-DD` */
  dueDate: string | null;
  /** Tizedes szöveg; HUF-nál a Számlázz.hu egész forintja. */
  grossAmount: DecimalText;
  currency: string;
  status: BillingDocumentStatus;
  emailStatus: BillingEmailStatus | null;
  opens: BillingDocumentListTarget;
  origin: BillingDocumentOrigin;
  /**
   * Külső bizonylatnál a Számlázz.hu bizonylattípusának felirata (Számla,
   * Sztornó számla, ...), ismeretlen kódnál maga a kód; a mieinknél `null`.
   */
  externalKindLabel: string | null;
  /**
   * A KIFIZETETTSÉG (Balázs, GLS szál, 2026-10-01), a bejövő listával azonos
   * mezőnevekkel és számítással (`paymentStateOf`). `null`: nincs forrásunk
   * rá (a saját bizonylat), vagy nem fizetendő (sztornózott számla).
   */
  paymentState: BillingPaymentState | null;
  /** A kifizetések összege; `paymentState` `null`-jánál `null`. */
  paidAmount: DecimalText | null;
  /** `YYYY-MM-DD`, a legkésőbbi kifizetés. */
  lastPaymentDate: string | null;
  /**
   * HONNAN TUDJUK (acrobot 25938): `SZAMLAZZ` = a Számlázz.hu kifizetés-adata
   * (vagy kimenőn a hiánya, átutalásnál); `CARD_AT_ORDER` / `CASH_AT_ORDER` =
   * kártyával vagy készpénzzel fizetve a rendeléskor, a Számlázz.hu-ban nincs
   * rögzítve. `null`, ahol a `paymentState` is az, vagy ismeretlen.
   */
  paymentSource: BillingPaymentSource | null;
}

/**
 * HONNAN TUDJUK A KIFIZETÉST: a Számlázz.hu rögzítette; a vevő a rendeléskor
 * kártyával vagy készpénzzel fizetett; vagy a SimplePay elszámolás-sora mondja
 * meg (a rendelésszám szerint), és ha abban visszatérítés is van, azt jelöljük
 * (acrobot 25979).
 */
export type BillingPaymentSource =
  | "SZAMLAZZ"
  | "CARD_AT_ORDER"
  | "CASH_AT_ORDER"
  | "SIMPLEPAY"
  | "SIMPLEPAY_REFUNDED"
  // a saját, a Számlázz.hu-ba beírt jelölésünk (OutgoingPaymentMark), amíg a
  // feed nem hozza a fizetést (acrobot 26027)
  | "MARK_GLS_COD"
  | "MARK_SIMPLEPAY"
  | "MARK_FOXPOST";

/**
 * EGY SAJÁT KIFIZETETT-JELÖLÉS, AMIT A SZÁMLÁZZ.HU ELFOGADOTT (acrobot 26027).
 * Az adatlap mindig mutatja; ha a feed már kifizetettet mond, kiegészítő adat.
 */
export interface BillingOwnPaymentMark {
  source: "GLS_COD" | "SIMPLEPAY" | "FOXPOST";
  /** `YYYY-MM-DD`, a kifizetés napja, ahogy a Számlázz.hu-ba került. */
  date: string;
  amount: DecimalText;
}

/** Egy külső bizonylat tétele, ahogy a számlán áll (szamla.xsd `tetel`). */
export interface BillingExternalDocumentLine {
  name: string;
  quantity: DecimalText;
  unit: string;
  unitNet: DecimalText;
  /** A kulcs, ahogy a számlán áll: 27, 5, AAM, TAM, ... */
  vatRate: string;
  netAmount: DecimalText;
  vatAmount: DecimalText;
  grossAmount: DecimalText;
}

/** `GET /billing/external-documents/:id`: a külső bizonylat, csak olvasásra. */
export interface BillingExternalDocumentDetail {
  id: string;
  source: "SZAMLAZZ";
  kindCode: string;
  kindLabel: string;
  documentNumber: string;
  invoiceFormat: InvoiceFormat;
  issueDate: string;
  fulfillmentDate: string | null;
  dueDate: string | null;
  paymentMethod: string | null;
  currency: string;
  customer: {
    name: string;
    taxNumber: string | null;
    address: string | null;
  };
  lines: BillingExternalDocumentLine[];
  totals: {
    netAmount: DecimalText;
    vatAmount: DecimalText;
    grossAmount: DecimalText;
  };
  /** A Számlázz.hu szerint sztornózott. */
  cancelled: boolean;
  /** Lásd `BillingDocumentListItem.paymentState`. */
  paymentState: BillingPaymentState | null;
  paidAmount: DecimalText | null;
  lastPaymentDate: string | null;
  paymentSource: BillingPaymentSource | null;
  /** Küldött-e a Számlázz.hu kifizetés-adatot (a bejövő adatlapé szerint). */
  paymentsKnown: boolean;
  /** A kifizetések a számla sorrendjében; `title` a jogcím. */
  payments: {
    date: string;
    title: string;
    amount: DecimalText;
    note: string | null;
  }[];
  /** A saját, a Számlázz.hu-ba beírt kifizetett-jelölések, napjuk szerint. */
  ownPaymentMarks: BillingOwnPaymentMark[];
  /** `alap.rendelesszam`: a webshop rendelésszáma; `null`, ha nincs. */
  orderNumber: string | null;
  /** `alap.fizmodunified`: a Számlázz.hu egységesített fizetési módja. */
  paymentMethodUnified: string | null;
  /** Hány változat érkezett; a lap a legkésőbbit mutatja. */
  versionCount: number;
  /** A mutatott változat érkezése (ISO időbélyeg). */
  receivedAt: string;
}

export interface BillingDocumentListResponse {
  items: BillingDocumentListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * Honnan jön a részletek vevő-blokkja: vázlatnál a partner MAI adata,
 * kiállított bizonylatnál a kiállításkor elküldött pillanatkép (brief 15.
 * pont). Egy kiállított bizonylat soha nem a partner mai adatát mutatja.
 */
export const BILLING_CUSTOMER_SOURCES = [
  "DRAFT_PARTNER",
  "ISSUED_SNAPSHOT",
] as const;
export type BillingCustomerSource = (typeof BILLING_CUSTOMER_SOURCES)[number];

/** A kiállítás nyoma a Számlázz.hu felé. */
export interface BillingDocumentSzamlazzInfo {
  documentNumber: string | null;
  issueState: BillingDocumentStatus;
  /** `szamlaKulsoAzon`, ami mindig az `Invoice.id`. */
  externalId: string;
  issueAttemptCount: number;
  /** `ISSUE_FAILED` vagy ismeretlen kimenet oka; egyébként `null`. */
  lastError: string | null;
  /**
   * A bizonylat a Számlázz.hu vevői fiókjában (`vevoifiokurl`), ha a
   * Számlázz.hu adott ilyet; a kiküldés `{document_link}`-je is ez.
   */
  documentUrl: string | null;
}

/** Csak `ISSUED`-nél `true`, és csak ha a tárolt PDF megvan. */
export interface BillingDocumentPdfInfo {
  available: boolean;
}

export const BILLING_DELIVERY_OUTCOMES = [
  "SENT",
  "FAILED",
  "INDETERMINATE",
] as const;
export type BillingDeliveryOutcome = (typeof BILLING_DELIVERY_OUTCOMES)[number];

export interface BillingEmailRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

export interface BillingDocumentDeliveryInfo {
  status: BillingEmailStatus | null;
  lastAttempt: {
    recipients: BillingEmailRecipients;
    outcome: BillingDeliveryOutcome;
    /** ISO időbélyeg */
    at: string;
    error: string | null;
  } | null;
  /** A felület csak akkor kínálja fel a kiküldés gombját, ha `true`. */
  canResend: boolean;
}

/**
 * EGY SZÁMLASOR KÉSZLETHATÁSA a kiállításkor (Balázs kérése, 2026-09-30). A
 * felület soronként kiírja, hogy a sor levont-e készletet, és ha nem, miért.
 *
 * - `MOVED`: levonva az OS-ben (UNAS-terméknél a UNAS felé is sorba állítva);
 * - `NOT_STOCKED`: egyedi tétel, szolgáltatás vagy kedvezmény-sor;
 * - `NOT_A_STOCK_DOCUMENT`: díjbekérő, előleg vagy szállítólevél;
 * - `MOVED_BY_SOURCE`: a forrás (webshop-rendelés, POS) már levonta;
 * - `VARIANT_NOT_CHOSEN`: a terméknek több változata van, a sor nem mondja meg,
 *   melyik;
 * - `NO_VARIANT`: a terméknek nincs aktív változata;
 * - `PACKAGE_UNRESOLVED`: csomagtermék, amelynek összetevői nem oldhatók fel.
 */
export const BILLING_LINE_STOCK_OUTCOMES = [
  "MOVED",
  "NOT_STOCKED",
  "NOT_A_STOCK_DOCUMENT",
  "MOVED_BY_SOURCE",
  "VARIANT_NOT_CHOSEN",
  "NO_VARIANT",
  "PACKAGE_UNRESOLVED",
] as const;
export type BillingLineStockOutcome =
  (typeof BILLING_LINE_STOCK_OUTCOMES)[number];

/**
 * A kiküldés módja. `SEND` az első kiküldés, `RETRY` egy bukott után,
 * `RESEND` egy sikeres után, kifejezett kérésre.
 */
export const BILLING_EMAIL_MODES = ["SEND", "RETRY", "RESEND"] as const;
export type BillingEmailMode = (typeof BILLING_EMAIL_MODES)[number];

/**
 * `POST /billing/documents/:id/email` törzse.
 *
 * A tárgy és a törzs NYERS szöveg, egy kapcsos zárójeles változókkal
 * (`{customer_name}`, `{document_number}`, ...): a szerver helyettesít be a
 * küldés pillanatában. Ismeretlen vagy érték nélküli változónál a szerver
 * nem küld, hanem 400-at ad.
 */
export interface BillingDocumentEmailInput {
  /** UUID a klienstől: ugyanazzal a `requestId`-val egy kézbesítés lesz. */
  requestId: string;
  mode: BillingEmailMode;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  /**
   * FORMÁZOTT TÖRZS (Balázs kérése a stage-en, 2026-09-30 20:26 UTC, acrobot
   * 25346): ha megvan, a levél ebből megy, tisztított HTML-ként és belőle
   * készült szöveges alternatívával; a `body` akkor nem számít.
   */
  bodyHtml?: string | null;
}

/**
 * Melyik kiküldési mód illik a bizonylat mostani állapotára; `null`, ha most
 * semmilyen (nem kiállított bizonylat, vagy épp fut egy küldés).
 *
 * A felület ebből választja a gomb módját, a szerver ugyanezzel ellenőrzi a
 * kérést (rossz mód: 409). Egy helyen áll, hogy a kettő ne térhessen el.
 */
export function billingEmailModeFor(
  status: BillingDocumentStatus,
  emailStatus: BillingEmailStatus | null,
): BillingEmailMode | null {
  if (status !== "ISSUED") return null;
  switch (emailStatus) {
    case null:
    case "NOT_REQUIRED":
    case "PENDING":
      return "SEND";
    case "FAILED":
      return "RETRY";
    case "SENT":
      return "RESEND";
    case "SENDING":
      return null;
  }
}
