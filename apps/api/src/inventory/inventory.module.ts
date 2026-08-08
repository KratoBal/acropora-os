import { Module } from "@nestjs/common";

import { UnasImportModule } from "../imports/unas/unas-import.module.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import { InventoryCountController } from "./inventory-count.controller.js";
import { InventoryCountRepository } from "./inventory-count.repository.js";
import { InventoryCountService } from "./inventory-count.service.js";
import { StockReconciliationRepairController } from "./stock-reconciliation-repair.controller.js";
import { StockReconciliationRepairRepository } from "./stock-reconciliation-repair.repository.js";
import { StockReconciliationRepairService } from "./stock-reconciliation-repair.service.js";
import { StockReconciliationController } from "./stock-reconciliation.controller.js";
import { StockReconciliationRepository } from "./stock-reconciliation.repository.js";
import { StockReconciliationService } from "./stock-reconciliation.service.js";
import { UnasStockSyncOutboxController } from "./unas-stock-sync-outbox.controller.js";
import { UnasStockSyncOutboxRepository } from "./unas-stock-sync-outbox.repository.js";
import { UnasStockSyncOutboxScheduler } from "./unas-stock-sync-outbox.scheduler.js";
import { UnasStockSyncOutboxService } from "./unas-stock-sync-outbox.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [
    InventoryCountController,
    UnasStockSyncOutboxController,
    StockReconciliationController,
    StockReconciliationRepairController,
  ],
  providers: [
    InventoryCountRepository,
    InventoryCountService,
    InventoryCountXlsx,
    UnasStockSyncOutboxRepository,
    UnasStockSyncOutboxService,
    UnasStockSyncOutboxScheduler,
    StockReconciliationRepository,
    StockReconciliationService,
    StockReconciliationRepairRepository,
    StockReconciliationRepairService,
  ],
  // StockReconciliationService is also consumed by health/health.module.ts
  // (StockDiagnosticsService) - the checkpoint-6 diagnostics report reuses
  // this EXACT read-only summarize() rather than re-implementing its own
  // reconciliation pass.
  exports: [
    UnasStockSyncOutboxRepository,
    UnasStockSyncOutboxService,
    StockReconciliationService,
  ],
})
export class InventoryModule {}
