var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { BrandsController } from "./brands.controller.js";
import { BrandsRepository } from "./brands.repository.js";
import { BrandsService } from "./brands.service.js";
import { BrandImportAssistantController } from "./brand-import-assistant.controller.js";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";
import { ProductModule } from "../products/product.module.js";
let BrandsModule = class BrandsModule {
};
BrandsModule = __decorate([
    Module({
        imports: [ProductModule],
        controllers: [BrandImportAssistantController, BrandsController],
        providers: [BrandImportAssistantService, BrandsRepository, BrandsService],
        exports: [BrandsRepository],
    })
], BrandsModule);
export { BrandsModule };
//# sourceMappingURL=brands.module.js.map