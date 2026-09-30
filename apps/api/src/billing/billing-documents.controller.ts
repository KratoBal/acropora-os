import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT VÉGPONTJAI (Számlázás v0.1). A kiállítás és a kiküldés
 * (`:id/issue`, `:id/email`) nautilusé, az adapterrel együtt; a szerződés:
 * `agents/murena/megosztas/szamlazas-vazlat-vegpontok.md`.
 *
 * A JOGOK A BILLING-JOGOK (#1276, brief 27. és 29. pont): a betöltés
 * `billing.view`, a vázlat létrehozása és mentése `billing.create`. Mindkettő a
 * pénzügyi jogokból képzett (aki ma `finance.view`, `finance.manage`), tehát
 * senkinek nem változik, ki mit ér el.
 */
@Controller("billing/documents")
export class BillingDocumentsController {
  constructor(private readonly service: BillingDocumentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  create(
    @Body() input: BillingDocumentDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Put(":id")
  @RequirePermissions(PERMISSIONS.BILLING_CREATE)
  update(@Param("id") id: string, @Body() input: BillingDocumentDraftDto) {
    return this.service.update(id, input);
  }
}
