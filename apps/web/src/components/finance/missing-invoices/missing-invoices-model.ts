import type { PilotBadgeVariant } from "@acropora/ui";

/**
 * HIÁNYZÓ SZÁMLÁK: A FELÜLET SAJÁT NÉZET-MODELLJE (Balázs briefje, 2026-09-30).
 *
 * SZÁNDÉKOSAN NEM a `packages/types`-ban áll: a drót-típusokat nautilus írja a
 * háttérrel együtt (a számlázásnál is így volt, #1281), és két példány ugyanarról
 * elcsúszna. A felület ezekre a megjelenítési alakokra épül; a szerződés után egy
 * vékony átalakító köti a kettőt.
 *
 * AZ ÁLLAPOTOK ÉS A FÜLEK VISZONYA (acrobot 25261, a Figma számaiból mérve:
 * augusztusban 15 nem párosodott + 25 nincs számla = "1–7 / 40 hiányzó
 * terhelés"):
 *   Hiányzik        = Nem párosodott + Nincs számla + Nem a cégre szól + Csak díjbekérő
 *   Nincs számla    csempe: a Nem a cégre szól és a Csak díjbekérő is ide számít
 *   Terhelések      a Nem kell számla NÉLKÜL (27 + 15 + 25 = 67)
 */
export type ChargeInvoiceState =
  | "FOUND"
  | "UNMATCHED"
  | "NO_INVOICE"
  | "NOT_COMPANY"
  | "PROFORMA_ONLY"
  | "NOT_NEEDED";

export type MonthState = "READY" | "INCOMPLETE" | "NO_STATEMENT";

export type ChargeTab =
  "MISSING" | "UNMATCHED" | "FOUND" | "NOT_NEEDED" | "ALL";

export type InvoiceSource = "NAV" | "MAILBOX" | "DRIVE" | "SETTLEMENT";

export interface MonthRow {
  /** "2026-08" */
  month: string;
  state: MonthState;
  /** `null`: nincs kivonat, a szám nem nulla, hanem ismeretlen. */
  counts: {
    charges: number;
    found: number;
    unmatched: number;
    noInvoice: number;
  } | null;
  /** Forint, tizedes szöveg; `null`, ha nincs kivonat. */
  missingAmount: string | null;
}

export interface ChargeRow {
  id: string;
  /** "2026-08-03" */
  date: string;
  bankAccount: string;
  /** A kivonaton álló partner vagy kereskedő, ahogy a bank írja. */
  partner: string;
  narrative: string;
  /** Forintban könyvelt összeg, pozitív tizedes szöveg. */
  amountHuf: string;
  /** Az eredeti devizaösszeg, ha a terhelés nem forintban ment. */
  original: { amount: string; currency: string } | null;
  category: string;
  state: ChargeInvoiceState;
  invoice: { number: string; source: InvoiceSource } | null;
  note: string | null;
}

export interface CandidateInvoice {
  id: string;
  number: string;
  /** "2026-08-02" */
  date: string;
  grossAmount: string;
  currency: string;
  source: InvoiceSource;
}

export const CHARGE_STATE_LABELS: Record<ChargeInvoiceState, string> = {
  FOUND: "Megvan",
  UNMATCHED: "Nem párosodott",
  NO_INVOICE: "Nincs számla",
  NOT_COMPANY: "Nem a cégre szól",
  PROFORMA_ONLY: "Csak díjbekérő",
  NOT_NEEDED: "Nem kell számla",
};

export const CHARGE_STATE_BADGES: Record<
  ChargeInvoiceState,
  PilotBadgeVariant
> = {
  FOUND: "success",
  UNMATCHED: "amber",
  NO_INVOICE: "danger",
  NOT_COMPANY: "danger",
  PROFORMA_ONLY: "amber",
  NOT_NEEDED: "grey",
};

export const MONTH_STATE_LABELS: Record<MonthState, string> = {
  READY: "Kész a könyvelőnek",
  INCOMPLETE: "Hiányos",
  NO_STATEMENT: "Kivonat hiányzik",
};

export const MONTH_STATE_BADGES: Record<MonthState, PilotBadgeVariant> = {
  READY: "success",
  INCOMPLETE: "amber",
  NO_STATEMENT: "grey",
};

export const INVOICE_SOURCE_LABELS: Record<InvoiceSource, string> = {
  NAV: "NAV",
  MAILBOX: "Postafiók",
  DRIVE: "Drive",
  SETTLEMENT: "Elszámolás",
};

export const CHARGE_TABS: ReadonlyArray<{ key: ChargeTab; label: string }> = [
  { key: "MISSING", label: "Hiányzik" },
  { key: "UNMATCHED", label: "Nem párosodott" },
  { key: "FOUND", label: "Megvan" },
  { key: "NOT_NEEDED", label: "Nem kell számla" },
  { key: "ALL", label: "Mind" },
];

/** Melyik állapotok tartoznak egy fülhöz. A szűrés a szerveren fut; ez a szabály. */
export const TAB_STATES: Record<ChargeTab, readonly ChargeInvoiceState[]> = {
  MISSING: ["UNMATCHED", "NO_INVOICE", "NOT_COMPANY", "PROFORMA_ONLY"],
  UNMATCHED: ["UNMATCHED"],
  FOUND: ["FOUND"],
  NOT_NEEDED: ["NOT_NEEDED"],
  ALL: [
    "FOUND",
    "UNMATCHED",
    "NO_INVOICE",
    "NOT_COMPANY",
    "PROFORMA_ONLY",
    "NOT_NEEDED",
  ],
};

/**
 * MIT KELL TENNI (brief 11. pont), állapot szerint. A cég neve paraméter: a
 * szerver konfigurációjából jön, nem ebből a fájlból (brief 4. pont).
 */
export function whatToDo(
  state: ChargeInvoiceState,
  companyName: string,
): string | null {
  switch (state) {
    case "NO_INVOICE":
      return "Kérd el a számlát a partnertől.";
    case "NOT_COMPANY":
      return `A számla a magánszemély nevére szól: kérd újra az ${companyName} nevére.`;
    case "PROFORMA_ONLY":
      return "Díjbekérő van, a végszámla hiányzik.";
    case "UNMATCHED":
      return "Van számla ettől a partnertől, de egyik sem egyezik ezzel a terheléssel: párosítsd a javasolt számlák közül, vagy kérd el a hiányzót.";
    case "FOUND":
    case "NOT_NEEDED":
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
