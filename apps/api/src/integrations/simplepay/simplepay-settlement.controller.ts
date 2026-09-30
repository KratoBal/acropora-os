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
import { ApproveSimplePayLineDto } from "./dto/approve-simplepay-line.dto.js";
import { SimplePayReportListQueryDto } from "./dto/simplepay-report-list-query.dto.js";
import { SimplePayGmailSyncService } from "./simplepay-gmail-sync.service.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A weekly report is a few kilobytes; this is far above any real one. */
const SIMPLEPAY_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * SIMPLEPAY ELSZÁMOLÁS: the weekly reports, their transactions tied to the
 * webshop order and its invoice. The same shape and rights as the GLS
 * settlement: reading is finance.view, changing is finance.manage.
 */
@Controller("integrations/simplepay")
export class SimplePaySettlementController {
  constructor(
    private readonly settlements: SimplePaySettlementService,
    private readonly gmailSync: SimplePayGmailSyncService,
  ) {}

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
    return this.gmailSync.sync("MANUAL");
  }

  /** A weekly report (report_YYYYMMDD.csv), uploaded by hand. */
  @Post("reports")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: SIMPLEPAY_FILE_MAX_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A SimplePay-fájl kötelező.");
    return this.settlements.upload(file.buffer, file.originalname, user.id);
  }

  @Get("reports")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listReports(@Query() query: SimplePayReportListQueryDto) {
    return this.settlements.listReports(query);
  }

  /** The month's file in Luca's table shape (xlsx). */
  @Get("monthly/:year/:month/download")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async downloadMonthly(
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

  @Get("reports/:id")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  reportDetail(@Param("id") id: string) {
    return this.settlements.reportDetail(id);
  }

  @Post("reports/:id/reprocess")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  reprocess(@Param("id") id: string) {
    return this.settlements.reprocess(id);
  }

  @Post("reports/:id/lines/:lineId/approve")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  approveLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() input: ApproveSimplePayLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.approveLine(id, lineId, input, user.id);
  }
}
