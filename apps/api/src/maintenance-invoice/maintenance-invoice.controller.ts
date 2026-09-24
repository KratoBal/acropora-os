import { Controller, Param, Post } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";

/**
 * A KARBANTARTÁSI PISZKOZAT-SZÁMLA (ADR-014, 4. szelet).
 *
 * Ugyanaz a jog, mint a csomag vezérlőjén: `PARTNERS_MANAGE` -- a `SERVICE`
 * szerepkör (a technikus) szerkezetileg nem éri el.
 */
@Controller("partners/maintenance-invoice")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class MaintenanceInvoiceController {
  constructor(private readonly draftService: MaintenanceInvoiceDraftService) {}

  /**
   * A TELJESÍTÉSI IGAZOLÁS AZONOSÍTÓJÁVAL indul, nem egy önálló számla-
   * azonosítóval -- ez maga az idempotencia-kulcs: ha erre az igazolásra már
   * áll piszkozat, ez a hívás nem hoz létre újat, a meglévőt adja vissza.
   */
  @Post(":certificateId/draft")
  draft(@Param("certificateId") certificateId: string) {
    return this.draftService.draftFor(certificateId);
  }
}
