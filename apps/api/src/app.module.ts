import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { AuthModule } from "./auth/auth.module.js";
import { BrandsModule } from "./brands/brands.module.js";
import { AuthGuard } from "./auth/guards/auth.guard.js";
import { PermissionGuard } from "./auth/guards/permission.guard.js";
import { CustomersModule } from "./customers/customers.module.js";
import { UnasCustomerSyncModule } from "./customers/unas-customer-sync/unas-customer-sync.module.js";
import { HealthModule } from "./health/health.module.js";
import { UnasImportModule } from "./imports/unas/unas-import.module.js";
import { AiChatModule } from "./integrations/ai-chat/ai-chat.module.js";
import { AiUserContextModule } from "./integrations/ai/ai-user-context.module.js";
import { MedusaModule } from "./integrations/medusa/medusa.module.js";
import { NavOnlineInvoiceModule } from "./integrations/nav/nav-online-invoice.module.js";
import { PostalCodeModule } from "./integrations/postal-code/postal-code.module.js";
import { ViesVatModule } from "./integrations/vies/vies-vat.module.js";
import { FoxpostSettlementModule } from "./integrations/foxpost/foxpost-settlement.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { UnasOrderSyncModule } from "./orders/unas-order-sync/unas-order-sync.module.js";
import { PosModule } from "./pos/pos.module.js";
import { ProductModule } from "./products/product.module.js";
import { PurchasingModule } from "./purchasing/purchasing.module.js";
import { ServiceAssetsModule } from "./service-assets/service-assets.module.js";
import { SuppliersModule } from "./suppliers/suppliers.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { UsersModule } from "./users/users.module.js";
import { WorksheetsModule } from "./worksheets/worksheets.module.js";

@Module({
  imports: [
    AuthModule,
    BrandsModule,
    ProductModule,
    UnasImportModule,
    InventoryModule,
    PosModule,
    UnasOrderSyncModule,
    CustomersModule,
    UnasCustomerSyncModule,
    AiUserContextModule,
    AiChatModule,
    MedusaModule,
    NavOnlineInvoiceModule,
    PostalCodeModule,
    ViesVatModule,
    FoxpostSettlementModule,
    SuppliersModule,
    PurchasingModule,
    ServiceAssetsModule,
    WorksheetsModule,
    TasksModule,
    UsersModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
