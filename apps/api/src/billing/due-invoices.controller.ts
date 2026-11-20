import { Controller, Get, Header } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { PERMISSIONS, type DueInvoicesResponse } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { budapestDay } from "./billing-document-list.js";
import { buildDueInvoices } from "./due-invoices.js";
import { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import { attachedPdfIds } from "./incoming-pdf-attach.js";
import { loadCollectedPdfIndex } from "./incoming-collected-pdf.js";
import { incomingHasPdf } from "./incoming-pdf-state.js";
import {
  incomingListItems,
  loadManualPurchasePayments,
  loadPurchaseSubjects,
} from "./purchase-incoming.js";

/**
 * LEJÁRÓ SZÁMLÁK, CSAK OLVASÁS (Balázs, Acropora OS szál, 2026-11-20 14:50 UTC; acrobot 58227): az átutalással fizetendő, még nem
 * (teljesen) kifizetett bejövő számlák, a határidő szerint rendezve. A sorokat és a kifizetettséget UGYANAZ az építő adja, mint a
 * Bejövő számlák listáját (`incomingListItems`), tehát a két lista nem térhet el egymástól. A jog a Pénzügy olvasásáé
 * (`finance.view`): a lista bankszámlaszámokat hordoz.
 */
@Controller("billing")
@RequirePermissions(PERMISSIONS.FINANCE_VIEW)
export class DueInvoicesController {
  private readonly database = prisma;

  constructor(
    private readonly missing: MissingInvoicesService,
    private readonly reviews: IncomingReviewService,
  ) {}

  @Get("due-invoices")
  @Header("Cache-Control", "private, no-store")
  async list(): Promise<DueInvoicesResponse> {
    const [rows, pairings, collected, readings, purchases, attached] =
      await Promise.all([
        this.database.incomingBillingDocument.findMany(),
        this.missing.documentPairings(),
        loadCollectedPdfIndex(this.database),
        this.reviews.pendingReadings(),
        loadPurchaseSubjects(this.database),
        attachedPdfIds(this.database),
      ]);
    const manualPaid = await loadManualPurchasePayments(this.database, rows);
    return buildDueInvoices({
      items: incomingListItems({
        rows,
        pairings,
        hasCollectedPdf: (row) => incomingHasPdf(row, { attached, collected }),
        readings,
        purchases,
        manualPaid,
      }),
      bankAccounts: new Map(
        rows.map((row) => [row.id, row.supplierBankAccount]),
      ),
      today: budapestDay(new Date())!,
    });
  }
}
