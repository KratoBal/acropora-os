import { extname } from "node:path";

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
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
import { ApproveUnasImportDto } from "./dto/approve-unas-import.dto.js";
import {
  BrandReviewQueryDto,
  BulkBrandReviewDto,
  UpdateBrandReviewDto,
} from "./dto/brand-review.dto.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasBrandReviewService } from "./unas-brand-review.service.js";
import { UnasImportService } from "./unas-import.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller("imports/unas")
export class UnasImportController {
  constructor(
    private readonly service: UnasImportService,
    private readonly applyService: UnasApplyService,
    private readonly brandReviewService: UnasBrandReviewService,
  ) {}

  @Get(":batchId/brand-reviews")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  brandReviews(
    @Param("batchId") batchId: string,
    @Query() query: BrandReviewQueryDto,
  ) {
    return this.brandReviewService.list(batchId, query);
  }

  @Patch(":batchId/brand-reviews/:reviewId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  updateBrandReview(
    @Param("batchId") batchId: string,
    @Param("reviewId") reviewId: string,
    @Body() input: UpdateBrandReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.brandReviewService.update(batchId, reviewId, input, user.id);
  }

  @Post(":batchId/brand-reviews/bulk")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  bulkBrandReviews(
    @Param("batchId") batchId: string,
    @Body() input: BulkBrandReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.brandReviewService.bulk(batchId, input, user.id);
  }

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
