import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type SupplierPriceListUploadResult,
  type SupplierPriceListsResponse,
} from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MAX_PRICE_LIST_BYTES } from "./parse-price-list.js";
import { UploadPriceListDto } from "./price-list.dto.js";
import { PriceListService } from "./price-list.service.js";

/**
 * BESZÁLLÍTÓI ÁRLISTÁK (task beszallitoi-arlistak-2; Balázs 2026-10-23 10:24 UTC:
 * mehet a párosítás és a beszerzési ár termékenként, beszállítónként). Olvasás
 * `purchasing.view`, feltöltés és törlés `purchasing.manage`. A fájl nem
 * tárolódik; semmi nem ír a UNAS-ba, a webshopba vagy a Medusába.
 */
@Controller("purchasing/price-lists")
export class PriceListController {
  constructor(private readonly lists: PriceListService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  list(
    @Query("supplierId") supplierId?: string,
  ): Promise<SupplierPriceListsResponse> {
    return this.lists.lists(supplierId || undefined);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PRICE_LIST_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() input: UploadPriceListDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupplierPriceListUploadResult> {
    if (!file) throw new BadRequestException("A fájl kötelező.");
    return this.lists.upload({
      supplierId: input.supplierId,
      format: input.format,
      listDate: input.listDate,
      currency: input.currency,
      file: { originalname: file.originalname, buffer: file.buffer },
      userId: user.id,
    });
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ removedRows: number }> {
    return this.lists.remove(id, user.id);
  }
}
