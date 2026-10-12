import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * DÍJBEKÉRŐBŐL ELŐLEGSZÁMLA (számlázási brief, 2. pont): a díjbekérő
 * „Előlegszámla készítése” gombja. Vázlatot készít, tehát a jog a vázlat
 * létrehozásáé (`billing.create`); a kiállítás onnan a szokásos úton megy.
 */
@Controller("billing/documents")
export class BillingDocumentAdvanceController {
  constructor(private readonly documents: BillingDocumentsService) {}

  @Post(":id/advance")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  advance(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.advanceFromProforma(id, user);
  }
}
