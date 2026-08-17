import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { AddProductBarcodeDto } from "./dto/product-barcode.dto.js";
import { ProductBarcodeService } from "./product-barcode.service.js";

/**
 * Keyed by variant, mirroring ProductExtensionController: a barcode belongs
 * to one variant, never to the product as a whole, because two variants of
 * the same product are two different things at the till.
 */
@Controller("product-barcodes")
export class ProductBarcodeController {
  constructor(private readonly barcodes: ProductBarcodeService) {}

  @Get(":variantId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  list(@Param("variantId") variantId: string) {
    return this.barcodes.list(variantId);
  }

  @Post(":variantId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  add(
    @Param("variantId") variantId: string,
    @Body() input: AddProductBarcodeDto,
  ) {
    return this.barcodes.add(variantId, input);
  }

  @Patch(":variantId/:barcodeId/primary")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  setPrimary(
    @Param("variantId") variantId: string,
    @Param("barcodeId") barcodeId: string,
  ) {
    return this.barcodes.setPrimary(variantId, barcodeId);
  }

  @Delete(":variantId/:barcodeId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  remove(
    @Param("variantId") variantId: string,
    @Param("barcodeId") barcodeId: string,
  ) {
    return this.barcodes.remove(variantId, barcodeId);
  }
}
