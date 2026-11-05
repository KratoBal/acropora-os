import { Module } from "@nestjs/common";

import { InventoryModule } from "../inventory/inventory.module.js";
import { MessagesModule } from "../messages/messages.module.js";
import { MissingInvoicesModule } from "../missing-invoices/missing-invoices.module.js";
import { WebshopOrdersModule } from "../orders/webshop-orders/webshop-orders.module.js";
import { PartnerOrdersModule } from "../partner-orders/partner-orders.module.js";
import { PurchasingModule } from "../purchasing/purchasing.module.js";
import { DashboardAquariumWidgetsRepository } from "./dashboard-aquarium-widgets.repository.js";
import { DashboardFinanceWidgetsRepository } from "./dashboard-finance-widgets.repository.js";
import { DashboardLayoutRepository } from "./dashboard-layout.repository.js";
import { DashboardServiceWidgetsRepository } from "./dashboard-service-widgets.repository.js";
import { DashboardSystemWidgetsRepository } from "./dashboard-system-widgets.repository.js";
import { DashboardWidgetsService } from "./dashboard-widgets.service.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardRepository } from "./dashboard.repository.js";
import { DashboardService } from "./dashboard.service.js";

@Module({
  imports: [
    InventoryModule,
    PurchasingModule,
    MissingInvoicesModule,
    WebshopOrdersModule,
    MessagesModule,
    PartnerOrdersModule,
  ],
  controllers: [DashboardController],
  providers: [
    DashboardRepository,
    DashboardService,
    DashboardLayoutRepository,
    DashboardServiceWidgetsRepository,
    DashboardAquariumWidgetsRepository,
    DashboardFinanceWidgetsRepository,
    DashboardSystemWidgetsRepository,
    DashboardWidgetsService,
  ],
})
export class DashboardModule {}
