import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentEmailService } from "./billing-document-email.service.js";
import { BillingDocumentEmailDto } from "./dto/billing-document-email.dto.js";

/**
 * A KIKÜLDÉS ÉS AZ ÚJRAKÜLDÉS VÉGPONTJA (nautilus; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 * A jog `billing.resend` (#1276), a `finance.manage`-ből képzett.
 */
@Controller("billing/documents")
export class BillingDocumentEmailController {
  constructor(private readonly email: BillingDocumentEmailService) {}

  @Post(":id/email")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_RESEND)
  send(
    @Param("id") id: string,
    @Body() input: BillingDocumentEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.email.send(id, input, user);
  }
}
