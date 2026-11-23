import { Controller, Get, Header } from "@nestjs/common";
import { PERMISSIONS, type DueInvoicesResponse } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import { loadDueInvoices } from "./due-invoices.loader.js";

/**
 * LEJÁRÓ SZÁMLÁK, CSAK OLVASÁS (Balázs, Acropora OS szál, 2026-11-20 14:50 UTC; acrobot 58227): az átutalással fizetendő, még nem
 * (teljesen) kifizetett bejövő számlák, a határidő szerint rendezve. A sorokat és a kifizetettséget UGYANAZ az építő adja, mint a
 * Bejövő számlák listáját (`incomingListItems`), tehát a két lista nem térhet el egymástól. A jog a Pénzügy olvasásáé
 * (`finance.view`): a lista bankszámlaszámokat hordoz.
 */
@Controller("billing")
@RequirePermissions(PERMISSIONS.FINANCE_VIEW)
export class DueInvoicesController {
  constructor(
    private readonly missing: MissingInvoicesService,
    private readonly reviews: IncomingReviewService,
  ) {}

  @Get("due-invoices")
  @Header("Cache-Control", "private, no-store")
  list(): Promise<DueInvoicesResponse> {
    return loadDueInvoices({ missing: this.missing, reviews: this.reviews });
  }
}
