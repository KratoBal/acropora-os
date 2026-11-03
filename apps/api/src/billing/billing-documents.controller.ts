import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentsService } from "./billing-documents.service.js";
import { BillingDocumentDraftDto } from "./dto/billing-document-draft.dto.js";
import { OutgoingPaperOriginalDto } from "./dto/outgoing-paper-original.dto.js";
import {
  OutgoingDocumentNotFoundError,
  OutgoingDocumentNotIssuedError,
  setOutgoingPaperOriginal,
} from "./outgoing-paper-original.js";

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

  /**
   * „PAPÍRON MEGVAN” be- vagy kikapcsolása a saját kiállított számlán (Balázs, 2026-11-03): a PDF nem
   * kerül a havi kimenő csomagba. Ugyanaz a jog, mint a külső számlán; vázlaton 409.
   */
  @Post(":id/paper-original")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_VIEW, PERMISSIONS.FINANCE_MANAGE)
  async setPaperOriginal(
    @Param("id") id: string,
    @Body() input: OutgoingPaperOriginalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      await setOutgoingPaperOriginal(prisma, {
        origin: "OWN",
        id,
        marked: input.marked,
        userId: user.id,
      });
    } catch (error) {
      if (error instanceof OutgoingDocumentNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof OutgoingDocumentNotIssuedError)
        throw new ConflictException(error.message);
      throw error;
    }
    return this.service.detail(id);
  }
}
