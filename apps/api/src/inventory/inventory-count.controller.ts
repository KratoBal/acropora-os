import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { memoryStorage } from "multer";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { UpdateInventoryCountLineDto } from "./dto/update-inventory-count-line.dto.js";
import { InventoryCountService } from "./inventory-count.service.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

@Controller("inventory/counts")
export class InventoryCountController {
  constructor(private readonly counts: InventoryCountService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  list(@Query() query: InventoryCountListQueryDto) {
    return this.counts.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  detail(@Param("id") id: string) {
    return this.counts.getDetail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.counts.createCount(user.id);
  }

  @Get(":id/template.xlsx")
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async downloadTemplate(@Param("id") id: string) {
    const { filename, buffer } = await this.counts.exportTemplate(id);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${filename}"`,
      length: buffer.length,
    });
  }

  @Post(":id/upload")
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
      fileFilter: (_request, file, callback) => {
        const valid =
          file.originalname.toLowerCase().endsWith(".xlsx") &&
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
  upload(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Az XLSX fájl kötelező.");
    return this.counts.uploadCounts(id, file.buffer);
  }

  @Patch(":id/lines/:lineId")
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() dto: UpdateInventoryCountLineDto,
  ) {
    return this.counts.updateLineCount(id, lineId, dto.countedQty);
  }

  @Post(":id/apply")
  @RequirePermissions(PERMISSIONS.INVENTORY_MANAGE)
  apply(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.counts.applyCorrection(id, user.id);
  }
}
