import { Prisma } from "@acropora/database";
import type { DashboardOverdueInvoicesWidgetData } from "@acropora/types";

import { externalPaymentFields } from "../billing/billing-document-list.js";
import { budapestDayKey } from "./budapest-day.js";

/**
 * THE KINDS THAT CAN FALL DUE (owner decision, PR #1379, 2026-10-02):
 * invoices and proformas count, delivery notes (`SL`) do not. Every code of
 * the billing module's `EXTERNAL_KIND_TYPES` is decided here, one way or the
 * other; a test fails when a new code appears there, so it cannot slip in or
 * out of this widget silently.
 */
export const OVERDUE_COUNTED_KIND_CODES: readonly string[] = [
  "SZ",
  "SS",
  "JS",
  "HS",
  "VS",
  "ES",
  "D",
];
export const OVERDUE_EXCLUDED_KIND_CODES: readonly string[] = ["SL"];

/** The narrow row the rule needs: what `externalPaymentFields` reads, plus the due day. */
export interface OverdueInvoiceRow {
  kindCode: string;
  dueDate: Date | null;
  grossAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  lastPaymentDate: Date | null;
  paymentsKnown: boolean | null;
  paymentMethod: string | null;
  paymentMethodUnified: string | null;
  currency: string;
  cancelled: boolean;
}

const WEEK_DAYS = 7;

/**
 * LEJÁRÓ SZÁMLÁK, THE RULE (fleet constraint 3):
 *   - the payment state is `externalPaymentFields` (the billing list's own),
 *     called, never re-implemented; a cancelled document has none and is out;
 *   - only UNPAID counts, and PARTIAL with its OPEN part (|gross| - |paid|);
 *   - PAID (by Számlázz.hu, card or cash at ordering) is never due;
 *   - UNKNOWN is never overdue: past due without payment data is its own
 *     "nincs fizetési adat" figure;
 *   - only the kinds of `OVERDUE_COUNTED_KIND_CODES`;
 *   - days are Budapest calendar days: overdue = due before today.
 */
export function summarizeOverdueInvoices(
  rows: readonly OverdueInvoiceRow[],
  now: Date,
): DashboardOverdueInvoicesWidgetData {
  const today = budapestDayKey(now);
  const weekEnd = addDays(today, WEEK_DAYS);
  const open = new Map<string, Prisma.Decimal>();
  let overdue = 0;
  let dueToday = 0;
  let dueWithinWeek = 0;
  let noPaymentDataPastDue = 0;

  for (const row of rows) {
    if (!row.dueDate) continue;
    if (!OVERDUE_COUNTED_KIND_CODES.includes(row.kindCode.toUpperCase()))
      continue;
    const state = externalPaymentFields(row).paymentState;
    if (state === null || state === "PAID") continue;

    // `@db.Date`: the calendar day is the UTC date of the stored value
    const due = row.dueDate.toISOString().slice(0, 10);
    if (state === "UNKNOWN") {
      if (due < today) noPaymentDataPastDue += 1;
      continue;
    }
    if (due < today) {
      overdue += 1;
      const openPart = row.grossAmount.abs().minus(row.paidAmount.abs());
      if (openPart.greaterThan(0)) {
        const currency = row.currency.toUpperCase();
        open.set(
          currency,
          (open.get(currency) ?? new Prisma.Decimal(0)).plus(openPart),
        );
      }
    } else if (due === today) dueToday += 1;
    else if (due <= weekEnd) dueWithinWeek += 1;
  }

  return {
    overdue: {
      count: overdue,
      openAmounts: [...open.entries()]
        .sort(([a], [b]) =>
          a === "HUF" ? -1 : b === "HUF" ? 1 : a.localeCompare(b),
        )
        .map(([currency, amount]) => ({
          currency,
          amount: amount.toFixed(currency === "HUF" ? 0 : 2),
        })),
    },
    dueToday,
    dueWithinWeek,
    noPaymentDataPastDue,
  };
}

function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
