import { Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentsService } from "./billing-documents.service.js";

/**
 * KIÁLLÍTOTT BIZONYLAT MÁSOLÁSA ÚJ VÁZLATBA (os-szamla-masolas): a részletek
 * "Másolás új vázlatba" gombja. Vázlatot készít, tehát a jog a vázlat
 * létrehozásáé (`billing.create`); számot nem foglal, nem állít ki, nem küld
 * semmit a Számlázz.hu-ra. A kiállítás onnan a szokásos úton megy.
 */
@Controller("billing/documents")
export class BillingDocumentCopyController {
  constructor(private readonly documents: BillingDocumentsService) {}

  @Post(":id/copy")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  copy(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.copyFromIssued(id, user);
  }
}
