import { Module } from "@nestjs/common";

import { UnasImportModule } from "../imports/unas/unas-import.module.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import { InventoryCountController } from "./inventory-count.controller.js";
import { InventoryCountRepository } from "./inventory-count.repository.js";
import { InventoryCountService } from "./inventory-count.service.js";
import { UnasStockSyncOutboxController } from "./unas-stock-sync-outbox.controller.js";
import { UnasStockSyncOutboxRepository } from "./unas-stock-sync-outbox.repository.js";
import { UnasStockSyncOutboxScheduler } from "./unas-stock-sync-outbox.scheduler.js";
import { UnasStockSyncOutboxService } from "./unas-stock-sync-outbox.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [InventoryCountController, UnasStockSyncOutboxController],
  providers: [
    InventoryCountRepository,
    InventoryCountService,
    InventoryCountXlsx,
    UnasStockSyncOutboxRepository,
    UnasStockSyncOutboxService,
    UnasStockSyncOutboxScheduler,
  ],
  exports: [UnasStockSyncOutboxRepository],
})
export class InventoryModule {}
