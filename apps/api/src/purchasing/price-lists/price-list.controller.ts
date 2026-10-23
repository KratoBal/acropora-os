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
  type SupplierPriceSuggestionDecision,
  type SupplierPriceSuggestionsResponse,
  type VariantSupplierPrices,
} from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MAX_PRICE_LIST_BYTES } from "./parse-price-list.js";
import { DecideSuggestionsDto, UploadPriceListDto } from "./price-list.dto.js";
import { PriceListSuggestionService } from "./price-list-suggestion.service.js";
import { PriceListDisplayService } from "./price-list-display.service.js";
import { PriceListService } from "./price-list.service.js";

/**
 * BESZÁLLÍTÓI ÁRLISTÁK (task beszallitoi-arlistak-2; Balázs 2026-10-23 10:24 UTC:
 * mehet a párosítás és a beszerzési ár termékenként, beszállítónként). Olvasás
 * `purchasing.view`, feltöltés és törlés `purchasing.manage`. A fájl nem
 * tárolódik; semmi nem ír a UNAS-ba, a webshopba vagy a Medusába.
 */
@Controller("purchasing/price-lists")
export class PriceListController {
  constructor(
    private readonly lists: PriceListService,
    private readonly display: PriceListDisplayService,
    private readonly suggestions: PriceListSuggestionService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  list(
    @Query("supplierId") supplierId?: string,
  ): Promise<SupplierPriceListsResponse> {
    return this.lists.lists(supplierId || undefined);
  }

  /**
   * Egy termékváltozat beszállítói árai és a haszon (task beszallitoi-arlistak-4).
   * `purchasing.view`: a beszerzési ár ugyanaz a körnek látszik, mint a beszerzési
   * számlák és a termékkereső utolsó beszerzési ára.
   */
  @Get("variants/:variantId")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  forVariant(
    @Param("variantId") variantId: string,
  ): Promise<VariantSupplierPrices> {
    return this.display.forVariant(variantId);
  }

  /** A névből javasolt párosítások, amelyekre ember jóváhagyása vár (task arlista-nev-javaslat). */
  @Get("suggestions")
  @RequirePermissions(PERMISSIONS.PURCHASING_VIEW)
  pendingSuggestions(
    @Query("supplierId") supplierId?: string,
    @Query("offset") offset?: string,
  ): Promise<SupplierPriceSuggestionsResponse> {
    const skip = Number(offset);
    return this.suggestions.pending(
      supplierId || undefined,
      Number.isSafeInteger(skip) && skip > 0 ? skip : 0,
    );
  }

  @Post("suggestions/approve")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  approveSuggestions(
    @Body() input: DecideSuggestionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupplierPriceSuggestionDecision> {
    return this.suggestions.approve(input.ids, user.id);
  }

  @Post("suggestions/reject")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  rejectSuggestions(
    @Body() input: DecideSuggestionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SupplierPriceSuggestionDecision> {
    return this.suggestions.reject(input.ids, user.id);
  }

  /** Javaslat egy már feltöltött listához (a korábban feltöltöttekhez, vagy új járulék után). */
  @Post(":id/suggest")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  suggestForList(@Param("id") id: string) {
    return this.suggestions.generateForList(id);
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
