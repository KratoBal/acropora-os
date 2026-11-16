import { Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { OperationsReportQueryDto } from "./dto/operations-log-entry.dto.js";
import { renderOperationsReportPdf } from "./operations-report-pdf.js";
import { OperationsPartnerService } from "./operations-partner.service.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ A PARTNER-PORTÁLNAK (task os-uzemeltetesi-naplo, S5): a partner-fiók (`operations-log.partner.view`) a saját
 * helyszíneinek havi kimutatását olvassa, JSON-ban és PDF-ben. A belső végpontok (`operations-log/report`, `entries`) a partner-fióknak
 * zárva állnak (nincs meg a jogosultságuk), mert azok kollégák nevét és belső megjegyzést is mutatnak.
 */
@Controller("operations-log/partner")
export class OperationsPartnerController {
  constructor(private readonly service: OperationsPartnerService) {}

  @Get("sites")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_PARTNER_VIEW)
  sites(@CurrentUser() user: AuthenticatedUser) {
    return this.service.sites(user);
  }

  @Get("report")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_PARTNER_VIEW)
  report(
    @Query() query: OperationsReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.report(user, query);
  }

  @Get("report/pdf")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_PARTNER_VIEW)
  @Header("Cache-Control", "private, no-store")
  async pdf(
    @Query() query: OperationsReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.service.report(user, query);
    const bytes = await renderOperationsReportPdf({
      report: result.report,
      subject: result.siteLabel ?? "Helyszín",
      generatedAt: result.generatedAt,
    });
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `attachment; filename="uzemeltetesi-naplo-${result.report.month}.pdf"`,
    });
  }
}
