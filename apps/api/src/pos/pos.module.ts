import { Module } from "@nestjs/common";

import { PosController } from "./pos.controller.js";
import { PosProductSearchRepository } from "./pos-product-search.repository.js";
import { PosProductSearchService } from "./pos-product-search.service.js";
import { PosSaleRepository } from "./pos-sale.repository.js";
import { PosSaleService } from "./pos-sale.service.js";

// No longer imports UnasImportModule - PosSaleService's synchronous UNAS
// push was removed (stock now goes through the shared postInventoryMovement
// primitive + UnasStockSyncOutbox worker, see pos-sale.repository.ts), and
// no other provider in this module ever used UnasApiClient/UnasAuthService.
@Module({
  controllers: [PosController],
  providers: [
    PosProductSearchRepository,
    PosProductSearchService,
    PosSaleRepository,
    PosSaleService,
  ],
})
export class PosModule {}
