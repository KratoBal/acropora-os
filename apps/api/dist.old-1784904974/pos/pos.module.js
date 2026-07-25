var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { UnasImportModule } from "../imports/unas/unas-import.module.js";
import { PosController } from "./pos.controller.js";
import { PosProductSearchRepository } from "./pos-product-search.repository.js";
import { PosProductSearchService } from "./pos-product-search.service.js";
import { PosSaleRepository } from "./pos-sale.repository.js";
import { PosSaleService } from "./pos-sale.service.js";
let PosModule = class PosModule {
};
PosModule = __decorate([
    Module({
        imports: [UnasImportModule],
        controllers: [PosController],
        providers: [
            PosProductSearchRepository,
            PosProductSearchService,
            PosSaleRepository,
            PosSaleService,
        ],
    })
], PosModule);
export { PosModule };
//# sourceMappingURL=pos.module.js.map