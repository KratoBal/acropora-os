import type { ChargeDetailExtras } from "./missing-invoices-drawer";
import type {
  CandidateInvoice,
  ChargeCategory,
  ChargeInvoiceState,
  ChargeRow,
  InvoiceSource,
  ItemAction,
  MonthRow,
  MonthState,
} from "./missing-invoices-model";
import type { MonthSummary } from "./missing-invoices-month-detail";

/**
 * IDEIGLENES DRÓT-TÍPUSOK, szó szerint nautilus szerződéséből
 * (`agents/nautilus/megosztas/hianyzo-szamlak-vegpontok.md`, 2026-09-30).
 *
 * NEM MARADNAK ITT: a harmadik szelet a `packages/types/src/missing-invoices.ts`
 * -be teszi őket (murena 25263, acrobot 25301), és akkor ez a fájl csak az
 * átalakítókat tartja meg, a közös típusokra. Addig a bekötés ezekre épül, hogy
 * ne kelljen a szeletre várni.
 */
export interface MissingInvoiceMonth {
  month: string;
  debitCount: number;
  found: number;
  notMatched: number;
  noInvoice: number;
  noInvoiceNeeded: number;
  missingAmountHuf: string;
  status: MonthState;
  missingStatementAccounts: string[];
}

/**
 * A CÉG AZONOSSÁGA, akinek a nevére a számla szólhat. A szerver a cég-azonosság
 * egyetlen helyéről adja (nautilus 25303: `ACROPORA_COMPANY`), a felület nem
 * égeti be.
 */
export interface MissingInvoiceCompany {
  name: string;
  taxNumber: string;
}

/** `GET /missing-invoices/months` (nautilus 25303: egy hívás, a céggel együtt). */
export interface MissingInvoiceMonthsResponse {
  company: MissingInvoiceCompany;
  months: MissingInvoiceMonth[];
}

export interface MissingInvoiceItem {
  id: string;
  bookingDate: string;
  account: { id: string; name: string };
  partner: string | null;
  narrative: string;
  amount: string;
  currency: string;
  original: { amount: string; currency: string } | null;
  category: ChargeCategory;
  categoryRule: string;
  categoryOverridden: boolean;
  state: ChargeInvoiceState;
  document: { id: string; number: string; source: InvoiceSource } | null;
  matchedBy: "RULE" | "MANUAL" | null;
  comment: string | null;
}

export interface MissingInvoiceMonthDetail {
  month: string;
  status: MonthState;
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

export interface MissingInvoiceItemDetail extends MissingInvoiceItem {
  candidates: {
    documentId: string;
    number: string;
    date: string;
    gross: string;
    currency: string;
    source: InvoiceSource;
    payee: "COMPANY" | "NOT_COMPANY" | "UNKNOWN";
  }[];
  action: ItemAction;
  driveFolderUrl: string | null;
}

export function toMonthRow(month: MissingInvoiceMonth): MonthRow {
  return {
    month: month.month,
    state: month.status,
    counts: {
      charges: month.debitCount,
      found: month.found,
      notMatched: month.notMatched,
      noInvoice: month.noInvoice,
    },
    missingAmountHuf: month.missingAmountHuf,
    missingStatementAccounts: month.missingStatementAccounts,
  };
}

export function toChargeRow(item: MissingInvoiceItem): ChargeRow {
  return {
    id: item.id,
    date: item.bookingDate,
    account: item.account,
    partner: item.partner,
    narrative: item.narrative,
    amount: item.amount,
    currency: item.currency,
    original: item.original,
    category: item.category,
    categoryRule: item.categoryRule,
    categoryOverridden: item.categoryOverridden,
    state: item.state,
    document: item.document
      ? { number: item.document.number, source: item.document.source }
      : null,
    matchedBy: item.matchedBy,
    comment: item.comment,
  };
}

export function toSummary(
  tiles: MissingInvoiceMonthDetail["tiles"],
): MonthSummary {
  return { ...tiles };
}

export function toExtras(detail: MissingInvoiceItemDetail): ChargeDetailExtras {
  return {
    candidates: detail.candidates.map((candidate): CandidateInvoice => ({
      ...candidate,
    })),
    action: detail.action,
    driveFolderUrl: detail.driveFolderUrl,
  };
}
