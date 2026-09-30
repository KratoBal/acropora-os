import type {
  MissingInvoiceItem,
  MissingInvoiceMonth,
  MissingInvoiceMonthDetail,
  MissingInvoiceMonthsResponse,
} from "@acropora/types";

import type { ChargeRow, MonthRow } from "./missing-invoices-model";
import type { MonthSummary } from "./missing-invoices-month-detail";

/**
 * A DRÓT-TÍPUSOK A KÖZÖS CSOMAGBÓL (nautilus, `packages/types/src/missing-invoices.ts`,
 * #1297); itt csak az átalakítók állnak a felület nézet-modelljére. A tétel
 * részletei (`GET /missing-invoices/items/:id`) és azok átalakítója a 4.
 * szelettel jönnek.
 */
export type {
  MissingInvoiceItem,
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
  };
}

export function toSummary(
  tiles: MissingInvoiceMonthDetail["tiles"],
): MonthSummary {
  return { ...tiles };
}
