import type {
  MissingInvoiceCategory,
  MissingInvoiceDocumentSource,
  MissingInvoiceItemState,
  MissingInvoiceMonthStatus,
  MissingInvoiceTab,
} from "@acropora/types";
import type { PilotBadgeVariant } from "@acropora/ui";

/**
 * HIÁNYZÓ SZÁMLÁK: A FELÜLET NÉZET-MODELLJE (Balázs briefje, 2026-09-30).
 *
 * A KULCSNEVEK nautilus szerződéséből jönnek
 * (`agents/nautilus/megosztas/hianyzo-szamlak-vegpontok.md`), de a drót-típusok
 * NEM itt állnak: azokat ő írja a `packages/types`-ba a háttérrel együtt (a
 * számlázásnál is így volt, #1281), és két példány elcsúszna. A felület ezekre a
 * megjelenítési alakokra épül; a bekötés egy vékony átalakító.
 *
 * AZ ÁLLAPOTOK ÉS A FÜLEK VISZONYA (acrobot 25261, a Figma számaiból mérve:
 * augusztusban 15 nem párosodott + 25 nincs számla = "1–7 / 40 hiányzó
 * terhelés"):
 *   Hiányzik      = Nem párosodott + Nincs számla + Nem a cégre szól + Csak díjbekérő
 *                   + Eredeti hiányzik (acrobot 25328: csak NAV-adat, eredeti nincs;
 *                   a Figmában nincs, ÖTÖDIK csempe)
 *   Nincs számla  csempe: a Nem a cégre szól és a Csak díjbekérő is ide számít
 *   Terhelések    a Nem kell számla NÉLKÜL (27 + 15 + 25 = 67)
 */
export type ChargeInvoiceState = MissingInvoiceItemState;

/**
 * A HÓNAP ÁLLAPOTA. A negyedik (Részleges kivonat) a Figmában nincs, acrobot
 * döntése hozza (25265): az egyik bankszámlához van kivonat, a másikhoz nincs.
 */
export type MonthState = MissingInvoiceMonthStatus;

export type ChargeTab = MissingInvoiceTab;

export type InvoiceSource = MissingInvoiceDocumentSource;

export type ChargeCategory = MissingInvoiceCategory;

/** A „Mit kell tenni” szöveg kulcsa; a szerver az állapotból adja. */
export type ItemAction =
  | "REQUEST_INVOICE"
  | "REQUEST_REISSUE_TO_COMPANY"
  | "REQUEST_FINAL_INVOICE"
  | "PAIR_OR_UPLOAD"
  | "NONE";

export interface MonthRow {
  /** "2026-08" */
  month: string;
  state: MonthState;
  counts: {
    /** A Nem kell számla NÉLKÜL. */
    charges: number;
    found: number;
    notMatched: number;
    noInvoice: number;
    /** Csak NAV-adat van, eredeti (PDF vagy papír) nincs (acrobot 25328). */
    originalMissing: number;
  };
  /** Forint, tizedes szöveg. */
  missingAmountHuf: string;
  /** A bankszámlák neve, amelyekhez erre a hónapra nincs kivonat. */
  missingStatementAccounts: string[];
}

export interface BankAccountOption {
  id: string;
  name: string;
  hasStatement: boolean;
}

export interface ChargeRow {
  id: string;
  /** "2026-08-03" */
  date: string;
  account: { id: string; name: string };
  /** A kivonat nyers partner-neve; lehet, hogy a bank nem ad ilyet. */
  partner: string | null;
  narrative: string;
  /** A könyvelt összeg a bankszámla pénznemében, előjel nélkül. */
  amount: string;
  currency: string;
  /** A kártyás devizás vásárlás eredeti összege. */
  original: { amount: string; currency: string } | null;
  category: ChargeCategory;
  /** A besorolást döntő szabály mondata. */
  categoryRule: string;
  categoryOverridden: boolean;
  state: ChargeInvoiceState;
  document: { number: string; source: InvoiceSource } | null;
  matchedBy: "RULE" | "MANUAL" | null;
  comment: string | null;
}

export interface CandidateInvoice {
  documentId: string;
  number: string;
  /** "2026-08-02" */
  date: string;
  gross: string;
  currency: string;
  source: InvoiceSource;
  /** Kinek szól a számla. */
  payee: "COMPANY" | "NOT_COMPANY" | "UNKNOWN";
}

export const CHARGE_STATE_LABELS: Record<ChargeInvoiceState, string> = {
  FOUND: "Megvan",
  NOT_MATCHED: "Nem párosodott",
  NO_INVOICE: "Nincs számla",
  NOT_COMPANY: "Nem a cégre szól",
  PROFORMA_ONLY: "Csak díjbekérő",
  ORIGINAL_MISSING: "Eredeti hiányzik",
  NO_INVOICE_NEEDED: "Nem kell számla",
};

export const CHARGE_STATE_BADGES: Record<
  ChargeInvoiceState,
  PilotBadgeVariant
> = {
  FOUND: "success",
  NOT_MATCHED: "amber",
  NO_INVOICE: "danger",
  NOT_COMPANY: "danger",
  PROFORMA_ONLY: "amber",
  ORIGINAL_MISSING: "amber",
  NO_INVOICE_NEEDED: "grey",
};

export const MONTH_STATE_LABELS: Record<MonthState, string> = {
  READY: "Kész a könyvelőnek",
  INCOMPLETE: "Hiányos",
  STATEMENT_MISSING: "Kivonat hiányzik",
  STATEMENT_PARTIAL: "Részleges kivonat",
};

export const MONTH_STATE_BADGES: Record<MonthState, PilotBadgeVariant> = {
  READY: "success",
  INCOMPLETE: "amber",
  STATEMENT_MISSING: "grey",
  STATEMENT_PARTIAL: "grey",
};

export const INVOICE_SOURCE_LABELS: Record<InvoiceSource, string> = {
  NAV: "NAV",
  MAILBOX: "Postafiók",
  UPLOAD: "Feltöltés",
  DRIVE: "Drive",
  SETTLEMENT: "Elszámolás",
  PREMIUM_NOTICE: "Díjértesítő",
};

export const CATEGORY_LABELS: Record<ChargeCategory, string> = {
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
};

/**
 * A SZŰRŐ KATEGÓRIÁI (brief 8. pont). A Nem kell számla kategóriái (adó, bér,
 * bank, belső, kölcsön) a saját fülükön állnak, nem a szűrőben.
 */
export const FILTER_CATEGORIES: readonly ChargeCategory[] = [
  "DOMESTIC_SUPPLIER",
  "FOREIGN_SUPPLIER",
  "CARD_SUBSCRIPTION",
  "INSURANCE",
  "UNCERTAIN",
];

export const CHARGE_TABS: ReadonlyArray<{ key: ChargeTab; label: string }> = [
  { key: "MISSING", label: "Hiányzik" },
  { key: "NOT_MATCHED", label: "Nem párosodott" },
  { key: "FOUND", label: "Megvan" },
  { key: "NO_INVOICE_NEEDED", label: "Nem kell számla" },
  { key: "ALL", label: "Mind" },
];

/** Melyik állapotok tartoznak egy fülhöz. A szűrés a szerveren fut; ez a szabály. */
export const TAB_STATES: Record<ChargeTab, readonly ChargeInvoiceState[]> = {
  MISSING: [
    "NOT_MATCHED",
    "NO_INVOICE",
    "NOT_COMPANY",
    "PROFORMA_ONLY",
    "ORIGINAL_MISSING",
  ],
  NOT_MATCHED: ["NOT_MATCHED"],
  FOUND: ["FOUND"],
  NO_INVOICE_NEEDED: ["NO_INVOICE_NEEDED"],
  ALL: [
    "FOUND",
    "NOT_MATCHED",
    "NO_INVOICE",
    "NOT_COMPANY",
    "PROFORMA_ONLY",
    "ORIGINAL_MISSING",
    "NO_INVOICE_NEEDED",
  ],
};

/**
 * MIT KELL TENNI (brief 11. pont), a szerver kulcsa szerint. A cég neve
 * paraméter: a szerver konfigurációjából jön, nem ebből a fájlból (brief 4.
 * pont).
 */
export function whatToDo(
  action: ItemAction,
  companyName: string | null,
): string | null {
  switch (action) {
    case "REQUEST_INVOICE":
      return "Kérd el a számlát a partnertől.";
    case "REQUEST_REISSUE_TO_COMPANY":
      // A cég neve a szerver konfigurációjából jön; amíg nincs, a mondat
      // nem találja ki (brief 4. pont).
      return companyName
        ? `A számla a magánszemély nevére szól: kérd újra az ${companyName} nevére.`
        : "A számla a magánszemély nevére szól: kérd újra a cég nevére.";
    case "REQUEST_FINAL_INVOICE":
      return "Díjbekérő van, a végszámla hiányzik.";
    case "PAIR_OR_UPLOAD":
      return "Van számla ettől a partnertől, de egyik sem egyezik ezzel a terheléssel: párosítsd a javasolt számlák közül, vagy töltsd fel a hiányzót.";
    case "NONE":
      return null;
    default:
      // EGY MÉG NEM ISMERT KULCS (például az Eredeti hiányzik sajátja, amíg
      // nautilus nem küldi a nevét): a felület nem talál ki mondatot.
      return null;
  }
}

const MONTH_NAMES = [
  "január",
  "február",
  "március",
  "április",
  "május",
  "június",
  "július",
  "augusztus",
  "szeptember",
  "október",
  "november",
  "december",
];

/** "2026-08" -> "2026. augusztus" */
export function formatMonth(month: string): string {
  const [year, number] = month.split("-");
  const name = MONTH_NAMES[Number(number) - 1];
  return name ? `${year}. ${name}` : month;
}

/** "2026-08-03" -> "2026. 08. 03." */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${year}. ${month}. ${date}.`;
}

/** Forint egészre, más deviza két tizedesre, a magyar számformával. */
export function formatAmount(value: string, currency: string): string {
  const huf = currency.toUpperCase() === "HUF";
  const formatted = new Intl.NumberFormat("hu-HU", {
    minimumFractionDigits: huf ? 0 : 2,
    maximumFractionDigits: huf ? 0 : 2,
  }).format(Number(value));
  return huf ? `${formatted} Ft` : `${formatted} ${currency.toUpperCase()}`;
}
