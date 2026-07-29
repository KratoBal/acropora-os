import { Module } from "@nestjs/common";

import { MnbModule } from "../integrations/mnb/mnb.module.js";
import { SuppliersModule } from "../suppliers/suppliers.module.js";
import { NavIncomingInvoiceModule } from "./nav-incoming-invoices/nav-incoming-invoice.module.js";
import { PurchaseInvoiceRepository } from "./purchase-invoice.repository.js";
import { PurchaseProductSearchRepository } from "./purchase-product-search.repository.js";
import { PurchaseProductSearchService } from "./purchase-product-search.service.js";
import { PurchasingController } from "./purchasing.controller.js";
import { PurchasingService } from "./purchasing.service.js";

// No longer imports UnasImportModule - PurchasingService's synchronous UNAS
// push was removed (stock now goes through the shared postInventoryMovement
// primitive + UnasStockSyncOutbox worker, see purchase-invoice.repository.ts),
// and no other provider in this module ever used
// UnasApiClient/UnasAuthService.
@Module({
  imports: [MnbModule, SuppliersModule, NavIncomingInvoiceModule],
  controllers: [PurchasingController],
  providers: [
    PurchaseInvoiceRepository,
    PurchaseProductSearchRepository,
    PurchaseProductSearchService,
    PurchasingService,
  ],
})
export class PurchasingModule {}
