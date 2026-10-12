import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * ELŐLEGSZÁMLÁBÓL VÉGSZÁMLA (számlázási brief, 3. pont): az előlegszámla
 * „Végszámla készítése” gombja. Vázlatot készít, tehát a jog a vázlat
 * létrehozásáé (`billing.create`); a kiállítás onnan a szokásos úton megy.
 */
@Controller("billing/documents")
export class BillingDocumentFinalController {
  constructor(private readonly documents: BillingDocumentsService) {}

  @Post(":id/final")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  final(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.finalFromAdvance(id, user);
  }
}
