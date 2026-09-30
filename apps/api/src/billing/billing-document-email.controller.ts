import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentEmailDraftService } from "./billing-document-email-draft.service.js";
import { BillingDocumentEmailService } from "./billing-document-email.service.js";
import { BillingDocumentEmailDto } from "./dto/billing-document-email.dto.js";

/**
 * A KIKÜLDÉS ÉS AZ ÚJRAKÜLDÉS VÉGPONTJA (nautilus; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 * A jog `billing.resend` (#1276), a `finance.manage`-ből képzett.
 */
@Controller("billing/documents")
export class BillingDocumentEmailController {
  constructor(
    private readonly email: BillingDocumentEmailService,
    private readonly drafts: BillingDocumentEmailDraftService,
  ) {}

  /** A kiküldő fiók kiinduló szövege, a Levelezés oldal sablonjából. */
  @Get(":id/email-draft")
  @RequirePermissions(PERMISSIONS.BILLING_RESEND)
  draft(@Param("id") id: string) {
    return this.drafts.draft(id);
  }

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
