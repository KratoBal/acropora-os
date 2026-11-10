import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateProductDto } from "./dto/create-product.dto.js";
import {
  SetProductImageAltDto,
  SetProductImageOrderDto,
} from "./dto/product-image.dto.js";
import { ProductListQueryDto } from "./dto/product-list-query.dto.js";
import { SetVariantPriceDto } from "./dto/set-variant-price.dto.js";
import { SetVariantSaleDto } from "./dto/set-variant-sale.dto.js";
import { UpdateProductDto } from "./dto/update-product.dto.js";
import { UpdateProductNamesDto } from "./dto/update-product-names.dto.js";
import { ProductService } from "./product.service.js";

@Controller("products")
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  listProducts(@Query() query: ProductListQueryDto) {
    return this.products.listProducts(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  getProduct(@Param("id") id: string) {
    return this.products.getProduct(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  createProduct(
    @Body() input: CreateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.createProduct(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  updateProduct(@Param("id") id: string, @Body() input: UpdateProductDto) {
    return this.products.updateProduct(id, input);
  }

  /**
   * A nevek kozvetlen irasa (kartya 20b0dd47): a UNAS-gazdaju termeken is megy (a nevek Acropora-tulajdonuak).
   */
  @Patch(":id/names")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  updateProductNames(
    @Param("id") id: string,
    @Body() input: UpdateProductNamesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.updateProductNames(id, input, user.id);
  }

  @Put(":id/variants/:variantId/price")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setVariantPrice(
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @Body() input: SetVariantPriceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setVariantPrice(id, variantId, input, user.id);
  }

  /** A változat saját akciója (T4.1-D3); csak OS-gazdájú terméknél. */
  @Put(":id/variants/:variantId/sale")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setVariantSale(
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @Body() input: SetVariantSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setVariantSale(id, variantId, input, user.id);
  }

  @Delete(":id/variants/:variantId/sale")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  clearVariantSale(
    @Param("id") id: string,
    @Param("variantId") variantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.clearVariantSale(id, variantId, user.id);
  }

  @Patch(":id/images/:imageId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setImageAlt(
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @Body() input: SetProductImageAltDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setImageAlt(id, imageId, input, user.id);
  }

  /** Egy kép feltöltése a lista végére (T4.1-D3, 6. szelet); a mező neve `file`. */
  @Post(":id/images")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  uploadImage(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.uploadImage(id, file, user.id);
  }

  @Delete(":id/images/:imageId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  deleteImage(
    @Param("id") id: string,
    @Param("imageId") imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.deleteImage(id, imageId, user.id);
  }

  /** A kép fájlja a tárolóból; a feltöltött képnek nincs webcíme. */
  @Get(":id/images/:imageId/file")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  @Header("Cache-Control", "private, no-store")
  async imageFile(@Param("id") id: string, @Param("imageId") imageId: string) {
    const image = await this.products.imageFile(id, imageId);
    return new StreamableFile(image.bytes, {
      type: image.contentType,
      length: image.bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`,
    });
  }

  @Put(":id/images/order")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setImageOrder(
    @Param("id") id: string,
    @Body() input: SetProductImageOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.setImageOrder(id, input, user.id);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  archiveProduct(@Param("id") id: string) {
    return this.products.archiveProduct(id);
  }

  /**
   * Egyirányú útvonal, szándékosan: a cél a névben áll, nem a törzsben.
   *
   * Egy `{ authority: "..." }` törzs azt sugallná, hogy a visszaút is
   * választható, pedig nincs eldöntve, mi történjen ilyenkor a közben
   * elkészült helyi szerkesztésekkel.
   */
  @Post(":id/catalog-authority/acropora")
  @RequirePermissions(PERMISSIONS.PRODUCTS_CATALOG_AUTHORITY_TRANSFER)
  takeCatalogAuthority(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.takeCatalogAuthority(id, user.id);
  }
}
