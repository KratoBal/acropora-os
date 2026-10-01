import { Module } from "@nestjs/common";

import { InventoryModule } from "../inventory/inventory.module.js";
import { PurchasingModule } from "../purchasing/purchasing.module.js";
import { DashboardLayoutRepository } from "./dashboard-layout.repository.js";
import { DashboardWidgetsService } from "./dashboard-widgets.service.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardRepository } from "./dashboard.repository.js";
import { DashboardService } from "./dashboard.service.js";

@Module({
  imports: [InventoryModule, PurchasingModule],
  controllers: [DashboardController],
  providers: [
    DashboardRepository,
    DashboardService,
    DashboardLayoutRepository,
    DashboardWidgetsService,
  ],
})
export class DashboardModule {}
