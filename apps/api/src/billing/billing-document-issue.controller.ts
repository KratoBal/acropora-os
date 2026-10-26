import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
import { BillingDocumentPreviewService } from "./billing-document-preview.service.js";
import { BillingDocumentIssueDto } from "./dto/billing-document-issue.dto.js";

/**
 * A KIÁLLÍTÁS VÉGPONTJA (nautilus; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 * Ugyanaz az előtag, mint murena vázlat-végpontjaié; külön controller, hogy a
 * Számlázz.hu-hívás útja ne keveredjen a vázlat mentésével.
 *
 * A JOG `billing.issue` (#1276): a `finance.manage`-ből képzett, tehát ma
 * ugyanaz a kör állíthat ki, aki a vázlatot is mentheti.
 */
@Controller("billing/documents")
export class BillingDocumentIssueController {
  constructor(
    private readonly issuing: BillingDocumentIssueService,
    private readonly previews: BillingDocumentPreviewService,
  ) {}

  @Post(":id/issue")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  issue(
    @Param("id") id: string,
    @Body() input: BillingDocumentIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuing.issue(id, input.expectedUpdatedAt, user);
  }

  /**
   * ELŐNÉZET KIÁLLÍTÁS ELŐTT: a Számlázz.hu előnézeti PDF-je, szám, tárolás és
   * állapotváltozás nélkül. POST, mert a Számlázz.hu-t hívja; `billing.issue`,
   * mert a tárolt Agent-kulccsal megy.
   */
  @Post(":id/preview")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.BILLING_ISSUE)
  async preview(@Param("id") id: string) {
    const bytes = await this.previews.preview(id);
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: 'inline; filename="elonezet.pdf"',
    });
  }
}
