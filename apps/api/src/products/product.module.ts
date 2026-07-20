import { Module } from "@nestjs/common";

import { CatalogOptionsController } from "./catalog-options.controller.js";
import { ProductExtensionController } from "./product-extension.controller.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";
import { ProductExtensionService } from "./product-extension.service.js";
import { ProductController } from "./product.controller.js";
import { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

@Module({
  controllers: [
    ProductController,
    ProductExtensionController,
    CatalogOptionsController,
  ],
  providers: [
    ProductRepository,
    ProductService,
    ProductExtensionRepository,
    ProductExtensionService,
  ],
  exports: [ProductService, ProductExtensionService],
})
export class ProductModule {}
