import { Module } from "@nestjs/common";

import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { WorksheetsModule } from "../worksheets/worksheets.module.js";

import { MaintenanceOrdersController } from "./maintenance-orders.controller.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";
import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

@Module({
  imports: [ServiceJobsModule, WorksheetsModule],
  controllers: [MaintenanceOrdersController],
  providers: [MaintenanceOrdersRepository, MaintenanceOrdersService],
})
export class MaintenanceOrdersModule {}
