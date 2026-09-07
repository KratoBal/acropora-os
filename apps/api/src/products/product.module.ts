import { Module } from "@nestjs/common";

import { CatalogOptionsController } from "./catalog-options.controller.js";
import { ProductBarcodeController } from "./product-barcode.controller.js";
import { ProductBarcodeRepository } from "./product-barcode.repository.js";
import { ProductBarcodeService } from "./product-barcode.service.js";
import { ProductExtensionController } from "./product-extension.controller.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";
import { ProductExtensionService } from "./product-extension.service.js";
import { ProductShippingProfileController } from "./product-shipping-profile.controller.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";
import { ProductShippingProfileService } from "./product-shipping-profile.service.js";
import { ProductController } from "./product.controller.js";
import { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

@Module({
  controllers: [
    ProductController,
    ProductBarcodeController,
    ProductExtensionController,
    ProductShippingProfileController,
    CatalogOptionsController,
  ],
  providers: [
    ProductRepository,
    ProductService,
    ProductBarcodeRepository,
    ProductBarcodeService,
    ProductExtensionRepository,
    ProductShippingProfileRepository,
    ProductShippingProfileService,
    ProductExtensionService,
  ],
  exports: [ProductService, ProductExtensionService, ProductBarcodeRepository],
})
export class ProductModule {}
