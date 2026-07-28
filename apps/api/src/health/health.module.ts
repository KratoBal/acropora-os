import { Module } from "@nestjs/common";

import { InventoryModule } from "../inventory/inventory.module.js";
import { UnasOrderSyncModule } from "../orders/unas-order-sync/unas-order-sync.module.js";
import { StockDiagnosticsController } from "./stock-diagnostics.controller.js";
import { StockDiagnosticsRepository } from "./stock-diagnostics.repository.js";
import { StockDiagnosticsService } from "./stock-diagnostics.service.js";

@Module({
  imports: [InventoryModule, UnasOrderSyncModule],
  controllers: [StockDiagnosticsController],
  providers: [StockDiagnosticsRepository, StockDiagnosticsService],
})
export class HealthModule {}
