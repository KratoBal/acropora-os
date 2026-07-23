import { Module } from "@nestjs/common";

import { UnasImportModule } from "../../imports/unas/unas-import.module.js";
import { UnasCustomerSyncController } from "./unas-customer-sync.controller.js";
import { UnasCustomerSyncRepository } from "./unas-customer-sync.repository.js";
import { UnasCustomerSyncScheduler } from "./unas-customer-sync.scheduler.js";
import { UnasCustomerSyncService } from "./unas-customer-sync.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [UnasCustomerSyncController],
  providers: [
    UnasCustomerSyncRepository,
    UnasCustomerSyncService,
    UnasCustomerSyncScheduler,
  ],
})
export class UnasCustomerSyncModule {}
