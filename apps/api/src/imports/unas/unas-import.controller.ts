import { extname } from "node:path";

import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS } from "@acropora/types";
import { memoryStorage } from "multer";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasImportService } from "./unas-import.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller("imports/unas")
export class UnasImportController {
  constructor(private readonly service: UnasImportService) {}

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

  @Get(":batchId/report")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  report(@Param("batchId") batchId: string) {
    return this.service.getReport(batchId);
  }
}
