import { Module } from "@nestjs/common";

import { UnasImportModule } from "../imports/unas/unas-import.module.js";
import { PosController } from "./pos.controller.js";
import { PosProductSearchRepository } from "./pos-product-search.repository.js";
import { PosProductSearchService } from "./pos-product-search.service.js";
import { PosSaleRepository } from "./pos-sale.repository.js";
import { PosSaleService } from "./pos-sale.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [PosController],
  providers: [
    PosProductSearchRepository,
    PosProductSearchService,
    PosSaleRepository,
    PosSaleService,
  ],
})
export class PosModule {}
