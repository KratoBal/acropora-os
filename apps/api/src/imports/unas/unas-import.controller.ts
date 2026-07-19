import { extname } from "node:path";

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { memoryStorage } from "multer";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ApproveUnasImportDto } from "./dto/approve-unas-import.dto.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasImportService } from "./unas-import.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller("imports/unas")
export class UnasImportController {
  constructor(
    private readonly service: UnasImportService,
    private readonly applyService: UnasApplyService,
  ) {}

  @Post("catalog/dry-run")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        const valid =
          extname(file.originalname).toLowerCase() === ".xlsx" &&
          file.mimetype === XLSX_MIME;
        callback(
          valid
            ? null
            : new BadRequestException("Csak XLSX fájl tölthető fel."),
          valid,
        );
      },
    }),
  )
  dryRun(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Az XLSX fájl kötelező.");
    return this.service.stageAndDryRun(file);
  }

  @Post(":batchId/approve")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  approve(
    @Param("batchId") batchId: string,
    @Body() input: ApproveUnasImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.applyService.approve(batchId, input, user.id);
  }

  @Post(":batchId/apply")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  apply(
    @Param("batchId") batchId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.applyService.apply(batchId, user.id);
  }

  @Get(":batchId/report")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  report(@Param("batchId") batchId: string) {
    return this.service.getReport(batchId);
  }
}
