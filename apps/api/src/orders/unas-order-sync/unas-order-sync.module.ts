import { Module } from "@nestjs/common";

import { UnasImportModule } from "../../imports/unas/unas-import.module.js";
import { InventoryModule } from "../../inventory/inventory.module.js";
import { UnasOrderDeletionReconciliationRepository } from "./unas-order-deletion-reconciliation.repository.js";
import { UnasOrderDeletionReconciliationScheduler } from "./unas-order-deletion-reconciliation.scheduler.js";
import { UnasOrderDeletionReconciliationService } from "./unas-order-deletion-reconciliation.service.js";
import { UnasOrderStockAuditController } from "./unas-order-stock-audit.controller.js";
import { UnasOrderStockAuditRepository } from "./unas-order-stock-audit.repository.js";
import { UnasOrderStockAuditService } from "./unas-order-stock-audit.service.js";
import { UnasOrderSyncController } from "./unas-order-sync.controller.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncScheduler } from "./unas-order-sync.scheduler.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";

@Module({
  imports: [UnasImportModule, InventoryModule],
  controllers: [UnasOrderSyncController, UnasOrderStockAuditController],
  providers: [
    UnasOrderSyncRepository,
    UnasOrderSyncService,
    UnasOrderSyncScheduler,
    UnasOrderStockAuditRepository,
    UnasOrderStockAuditService,
    UnasOrderDeletionReconciliationRepository,
    UnasOrderDeletionReconciliationService,
    UnasOrderDeletionReconciliationScheduler,
  ],
  // UnasOrderStockAuditService is also consumed by health/health.module.ts
  // (StockDiagnosticsService) - the checkpoint-6 diagnostics/activation-
  // readiness surface reuses this EXACT read-only summarize() rather than
  // re-implementing its own order audit.
  exports: [UnasOrderStockAuditService],
})
export class UnasOrderSyncModule {}
