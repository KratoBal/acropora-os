var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from "@nestjs/common";
import { UnasImportModule } from "../imports/unas/unas-import.module.js";
import { MnbModule } from "../integrations/mnb/mnb.module.js";
import { SuppliersModule } from "../suppliers/suppliers.module.js";
import { NavIncomingInvoiceModule } from "./nav-incoming-invoices/nav-incoming-invoice.module.js";
import { PurchaseInvoiceRepository } from "./purchase-invoice.repository.js";
import { PurchaseProductSearchRepository } from "./purchase-product-search.repository.js";
import { PurchaseProductSearchService } from "./purchase-product-search.service.js";
import { PurchasingController } from "./purchasing.controller.js";
import { PurchasingService } from "./purchasing.service.js";
let PurchasingModule = class PurchasingModule {
};
PurchasingModule = __decorate([
    Module({
        imports: [
            UnasImportModule,
            MnbModule,
            SuppliersModule,
            NavIncomingInvoiceModule,
        ],
        controllers: [PurchasingController],
        providers: [
            PurchaseInvoiceRepository,
            PurchaseProductSearchRepository,
            PurchaseProductSearchService,
            PurchasingService,
        ],
    })
], PurchasingModule);
export { PurchasingModule };
//# sourceMappingURL=purchasing.module.js.map