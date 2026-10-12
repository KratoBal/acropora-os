import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentStornoService } from "./billing-document-storno.service.js";
import { BillingDocumentStornoPdfService } from "./billing-document-storno-pdf.service.js";
import { BillingDocumentStornoDto } from "./dto/billing-document-storno.dto.js";

/**
 * A SZTORNÓ VÉGPONTJAI (számlázási brief, 1. pont). A jog a kiállításé
 * (`billing.issue`): aki kiállíthat, az vonhatja vissza; a sztornó PDF-je a
 * részleteké (`billing.view`).
 */
@Controller("billing/documents")
export class BillingDocumentStornoController {
  constructor(
    private readonly storno: BillingDocumentStornoService,
    private readonly pdfs: BillingDocumentStornoPdfService,
  ) {}

  @Post(":id/storno")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  cancel(
    @Param("id") id: string,
    @Body() input: BillingDocumentStornoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storno.storno(id, input.reason, user);
  }

  /** Inline, mint a számla PDF-je: a nyomtatás ugyanezt nyitja meg. */
  @Get(":id/storno-pdf")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  async pdf(@Param("id") id: string) {
    const found = await this.pdfs.pdf(id);
    if (!found)
      throw new NotFoundException("Ehhez a számlához nincs sztornó PDF.");
    return new StreamableFile(found.bytes, {
      type: "application/pdf",
      length: found.bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(found.fileName)}`,
    });
  }
}
