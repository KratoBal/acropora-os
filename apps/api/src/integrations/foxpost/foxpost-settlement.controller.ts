import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { FoxpostSettlementListQueryDto } from "./dto/foxpost-settlement-list-query.dto.js";
import { FoxpostSettlementService } from "./foxpost-settlement.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller("integrations/foxpost")
export class FoxpostSettlementController {
  constructor(private readonly settlements: FoxpostSettlementService) {}

  @Get("settlements")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  list(@Query() query: FoxpostSettlementListQueryDto) {
    return this.settlements.list(query);
  }

  @Post("settlements/sync")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  sync() {
    return this.settlements.sync();
  }

  @Get("settlements/:id")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  detail(@Param("id") id: string) {
    return this.settlements.detail(id);
  }

  @Post("settlements/:id/reprocess")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  reprocess(@Param("id") id: string) {
    return this.settlements.reprocess(id);
  }

  @Get("reports")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  reports() {
    return this.settlements.listReports();
  }

  @Get("reports/:year/:month/download")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async downloadReport(
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    const { filename, buffer } = await this.settlements.downloadReport(
      year,
      month,
    );
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${filename}"`,
      length: buffer.length,
    });
  }
}
