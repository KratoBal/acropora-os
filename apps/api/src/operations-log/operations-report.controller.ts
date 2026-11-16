import { Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { OperationsReportQueryDto } from "./dto/operations-log-entry.dto.js";
import { renderOperationsReportPdf } from "./operations-report-pdf.js";
import { OperationsReportService } from "./operations-report.service.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ HAVI KIMUTATÁSA (task os-uzemeltetesi-naplo, S4): JSON a webes felületnek, PDF a letöltéshez. A BELSŐ nézet
 * (`operations-log.view`): a partner a saját, szűkített nézetét az S5-ben kapja, ugyanazzal a számítással, `PARTNER` nézővel.
 */
@Controller("operations-log/report")
export class OperationsReportController {
  constructor(private readonly service: OperationsReportService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  async report(@Query() query: OperationsReportQueryDto) {
    return this.service.build(query, "INTERNAL");
  }

  @Get("pdf")
  @RequirePermissions(PERMISSIONS.OPERATIONS_LOG_VIEW)
  @Header("Cache-Control", "private, no-store")
  async pdf(@Query() query: OperationsReportQueryDto) {
    const result = await this.service.build(query, "INTERNAL");
    const bytes = await renderOperationsReportPdf({
      report: result.report,
      subject: result.siteLabel ?? "Eszköz",
      generatedAt: result.generatedAt,
    });
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `attachment; filename="uzemeltetesi-naplo-${result.report.month}.pdf"`,
    });
  }
}
