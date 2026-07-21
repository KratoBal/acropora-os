import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { AuthModule } from "./auth/auth.module.js";
import { BrandsModule } from "./brands/brands.module.js";
import { AuthGuard } from "./auth/guards/auth.guard.js";
import { PermissionGuard } from "./auth/guards/permission.guard.js";
import { UnasImportModule } from "./imports/unas/unas-import.module.js";
import { InventoryModule } from "./inventory/inventory.module.js";
import { UnasOrderSyncModule } from "./orders/unas-order-sync/unas-order-sync.module.js";
import { PosModule } from "./pos/pos.module.js";
import { ProductModule } from "./products/product.module.js";

@Module({
  imports: [
    AuthModule,
    BrandsModule,
    ProductModule,
    UnasImportModule,
    InventoryModule,
    PosModule,
    UnasOrderSyncModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
