import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { memoryStorage } from "multer";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ApproveGlsCodLineDto } from "./dto/approve-gls-cod-line.dto.js";
import { GlsCodReportListQueryDto } from "./dto/gls-cod-report-list-query.dto.js";
import { GlsGmailSyncService } from "./gls-gmail-sync.service.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The largest measured GLS file is well under this. */
const GLS_FILE_MAX_BYTES = 15 * 1024 * 1024;

@Controller("integrations/gls")
export class GlsSettlementController {
  constructor(
    private readonly settlements: GlsSettlementService,
    private readonly gmailSync: GlsGmailSyncService,
  ) {}

  /** A GLS COD report or invoice attachment, uploaded by hand. */
  @Post("documents")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: GLS_FILE_MAX_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A GLS-fájl kötelező.");
    return this.settlements.upload(file.buffer, file.originalname, user.id);
  }

  @Get("cod-reports")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listReports(@Query() query: GlsCodReportListQueryDto) {
    return this.settlements.listReports(query);
  }

  @Get("cod-reports/:id")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  reportDetail(@Param("id") id: string) {
    return this.settlements.reportDetail(id);
  }

  @Post("cod-reports/:id/reprocess")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  reprocess(@Param("id") id: string) {
    return this.settlements.reprocess(id);
  }

  @Post("cod-reports/:id/lines/:lineId/approve")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  approveLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() input: ApproveGlsCodLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.approveLine(id, lineId, input, user.id);
  }

  @Get("reports/:year/:month/download")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async downloadReport(
    @Param("year", ParseIntPipe) year: number,
    @Param("month", ParseIntPipe) month: number,
  ) {
    const { filename, buffer } = await this.settlements.monthlyReport(
      year,
      month,
    );
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${filename}"`,
      length: buffer.length,
    });
  }

  /** Whether the Gmail pull runs, and why not; and its last run. */
  @Get("sync")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  syncStatus() {
    return this.gmailSync.status();
  }

  /** One Gmail pull now, whatever the switch says, if there is a key. */
  @Post("sync")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  syncNow() {
    return this.gmailSync.sync();
  }

  @Get("invoices")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listInvoices() {
    return this.settlements.listInvoices();
  }
}
