import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
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
import { GlsSettlementService } from "./gls-settlement.service.js";

/** The largest measured GLS file is well under this. */
const GLS_FILE_MAX_BYTES = 15 * 1024 * 1024;

@Controller("integrations/gls")
export class GlsSettlementController {
  constructor(private readonly settlements: GlsSettlementService) {}

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

  @Get("invoices")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listInvoices() {
    return this.settlements.listInvoices();
  }
}
