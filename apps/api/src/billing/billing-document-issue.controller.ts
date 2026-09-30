import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentIssueService } from "./billing-document-issue.service.js";
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
  constructor(private readonly issuing: BillingDocumentIssueService) {}

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
}
