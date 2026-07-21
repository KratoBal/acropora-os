import { Module } from "@nestjs/common";

import { UnasImportModule } from "../imports/unas/unas-import.module.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import { InventoryCountController } from "./inventory-count.controller.js";
import { InventoryCountRepository } from "./inventory-count.repository.js";
import { InventoryCountService } from "./inventory-count.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [InventoryCountController],
  providers: [
    InventoryCountRepository,
    InventoryCountService,
    InventoryCountXlsx,
  ],
})
export class InventoryModule {}
