var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { CatalogOptionsController } from "./catalog-options.controller.js";
import { ProductExtensionController } from "./product-extension.controller.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";
import { ProductExtensionService } from "./product-extension.service.js";
import { ProductController } from "./product.controller.js";
import { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";
let ProductModule = class ProductModule {
};
ProductModule = __decorate([
    Module({
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
], ProductModule);
export { ProductModule };
//# sourceMappingURL=product.module.js.map