import type {
  MissingInvoiceItem,
  MissingInvoiceItemDetail,
  MissingInvoiceMonth,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthsResponse,
} from "@acropora/types";

import type { ChargeDetailExtras } from "./missing-invoices-drawer";
import type { ChargeRow, MonthRow } from "./missing-invoices-model";
import type { MonthSummary } from "./missing-invoices-month-detail";

/**
 * A DRÓT-TÍPUSOK A KÖZÖS CSOMAGBÓL (nautilus, `packages/types/src/missing-invoices.ts`,
 * #1297, #1303); itt csak az átalakítók állnak a felület nézet-modelljére.
 */
export type {
  MissingInvoiceItem,
  MissingInvoiceItemDetail,
  MissingInvoiceMonth,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthsResponse,
} from "@acropora/types";

/** A cég azonossága, akinek a nevére a számla szólhat (a hónaplista válaszából). */
export type MissingInvoiceCompany = MissingInvoiceMonthsResponse["company"];

export function toMonthRow(month: MissingInvoiceMonth): MonthRow {
  return {
    month: month.month,
    state: month.status,
    counts: {
      charges: month.debitCount,
      found: month.found,
      notMatched: month.notMatched,
      noInvoice: month.noInvoice,
      originalMissing: month.originalMissing,
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
    documentNumbers: item.documentNumbers,
    missingNumbers: item.missingNumbers,
    amountDifference: item.amountDifference,
    paperOriginal: item.paperOriginal,
  };
}

export function toSummary(
  tiles: MissingInvoiceMonthDetail["tiles"],
): MonthSummary {
  return { ...tiles };
}

/** A drawer második kérésből jövő része (`GET /missing-invoices/items/:id`). */
export function toExtras(detail: MissingInvoiceItemDetail): ChargeDetailExtras {
  return {
    candidates: detail.candidates,
    // egy a mezőt még nem ismerő API (a web előbb települ) ne döntse el a drawert
    payeeDocuments: detail.payeeDocuments ?? [],
    action: detail.action,
    driveFolderUrl: detail.driveFolderUrl,
    // egy a mezőt még nem küldő API (a web előbb települ) ne döntse el a drawert
    doublePaidWith: detail.doublePaidWith ?? [],
  };
}
