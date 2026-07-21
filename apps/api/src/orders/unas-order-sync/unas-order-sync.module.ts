import { Module } from "@nestjs/common";

import { UnasImportModule } from "../../imports/unas/unas-import.module.js";
import { UnasOrderSyncController } from "./unas-order-sync.controller.js";
import { UnasOrderSyncRepository } from "./unas-order-sync.repository.js";
import { UnasOrderSyncScheduler } from "./unas-order-sync.scheduler.js";
import { UnasOrderSyncService } from "./unas-order-sync.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [UnasOrderSyncController],
  providers: [
    UnasOrderSyncRepository,
    UnasOrderSyncService,
    UnasOrderSyncScheduler,
  ],
})
export class UnasOrderSyncModule {}
