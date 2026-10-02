import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";
import type {
  DashboardIncomingInvoicesWidgetData,
  DashboardSettlementsWidgetData,
} from "@acropora/types";

import { budapestDayKey } from "./budapest-day.js";
import {
  OVERDUE_COUNTED_KIND_CODES,
  type OverdueInvoiceRow,
} from "./overdue-invoices.js";

/**
 * THE FINANCE AND PURCHASING WIDGETS' READS. Counts and narrow selects; the
 * billing and missing-invoice modules are only read here, never changed.
 */
@Injectable()
export class DashboardFinanceWidgetsRepository extends Repository {
  constructor() {
    super(prisma);
  }

  /**
   * The outgoing invoices that MAY be due within the week, narrowed in SQL
   * only by what is certain: not cancelled, a counted kind, a due day not
   * after the window, and not fully paid by recorded payments. Everything
   * else (card / cash at ordering, UNKNOWN, PARTIAL) is decided by
   * `externalPaymentFields` in `summarizeOverdueInvoices`.
   */
  async overdueInvoiceRows(
    now: Date,
    windowDays: number,
  ): Promise<OverdueInvoiceRow[]> {
    const [y, m, d] = budapestDayKey(now).split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const lastDay = new Date(Date.UTC(y, m - 1, d + windowDays));
    return this.database.externalBillingDocument.findMany({
      where: {
        cancelled: false,
        kindCode: { in: [...OVERDUE_COUNTED_KIND_CODES] },
        dueDate: { not: null, lte: lastDay },
        NOT: {
          paymentsKnown: true,
          paidAmount: {
            gte: this.database.externalBillingDocument.fields.grossAmount,
          },
        },
      },
      select: {
        kindCode: true,
        dueDate: true,
        grossAmount: true,
        paidAmount: true,
        lastPaymentDate: true,
        paymentsKnown: true,
        paymentMethod: true,
        paymentMethodUnified: true,
        currency: true,
        cancelled: true,
      },
    });
  }

  /** Bejövő számlák: the same filters the expected-arrivals list uses. */
  async incomingInvoices(): Promise<DashboardIncomingInvoicesWidgetData> {
    const [navToBook, navErrors, mailboxFailed, lateCorrections] =
      await Promise.all([
        this.database.navIncomingInvoice.count({
          where: {
            status: { in: ["NEW", "DATA_FETCHED"] },
            purchaseInvoiceId: null,
            invoiceOperation: "CREATE",
          },
        }),
        this.database.navIncomingInvoice.count({ where: { status: "ERROR" } }),
        this.database.incomingSupplierDocument.count({
          where: { status: "FAILED" },
        }),
        this.database.incomingSupplierDocument.count({
          where: { status: "LATE_CORRECTION" },
        }),
      ]);
    return { navToBook, navErrors, mailboxFailed, lateCorrections };
  }

  /** Elszámolások: review and error counts, and the last sync run of each source. */
  async settlements(): Promise<DashboardSettlementsWidgetData> {
    const [
      foxpostReview,
      foxpostErrors,
      glsReview,
      simplePayReview,
      foxpostRun,
      glsRun,
      simplePayRun,
    ] = await Promise.all([
      this.database.foxpostSettlement.count({
        where: { status: "NEEDS_REVIEW" },
      }),
      this.database.foxpostSettlement.count({ where: { status: "ERROR" } }),
      this.database.glsCodReport.count({ where: { status: "NEEDS_REVIEW" } }),
      this.database.simplePayReport.count({
        where: { status: "NEEDS_REVIEW" },
      }),
      this.database.foxpostSyncRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: { status: true, startedAt: true },
      }),
      this.database.glsSyncRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: { status: true, startedAt: true },
      }),
      this.database.simplePaySyncRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: { status: true, startedAt: true },
      }),
    ]);
    const run = (row: { status: string; startedAt: Date } | null) =>
      row
        ? { status: row.status, startedAt: row.startedAt.toISOString() }
        : null;
    return {
      sources: [
        {
          source: "FOXPOST",
          needsReview: foxpostReview,
          errors: foxpostErrors,
          lastRun: run(foxpostRun),
        },
        {
          source: "GLS",
          needsReview: glsReview,
          errors: 0,
          lastRun: run(glsRun),
        },
        {
          source: "SIMPLEPAY",
          needsReview: simplePayReview,
          errors: 0,
          lastRun: run(simplePayRun),
        },
      ],
    };
  }
}
