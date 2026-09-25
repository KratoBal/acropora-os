import { Module } from "@nestjs/common";

import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { WorksheetsModule } from "../worksheets/worksheets.module.js";

import { MaintenanceOrdersController } from "./maintenance-orders.controller.js";
import { MaintenanceOrdersPortalController } from "./maintenance-orders-portal.controller.js";
import { MaintenanceOrdersPortalService } from "./maintenance-orders-portal.service.js";
import { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";
import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

/**
 * A PORTÁL-CSATOLÁS: `MaintenanceOrdersPortalController`/`...PortalService`
 * UGYANEBBEN A MODULBAN, NEM KÜLÖNÁLLÓBAN -- a portál szolgáltatás a MEGLÉVŐ
 * `MaintenanceOrdersService.uploadSignedDocument()`-et hívja (lásd annak
 * fejlécét), tehát a DI-nek egy modulban kell látnia mindkettőt. A belső,
 * `PARTNERS_MANAGE`-es `MaintenanceOrdersController` EZZEL A BŐVÍTÉSSEL NEM
 * módosul -- a portál a SZOLGÁLTATÁST hívja, nem a végpontot.
 */
@Module({
  imports: [ServiceJobsModule, WorksheetsModule],
  controllers: [MaintenanceOrdersController, MaintenanceOrdersPortalController],
  providers: [
    MaintenanceOrdersRepository,
    MaintenanceOrdersService,
    MaintenanceOrdersPortalService,
  ],
})
export class MaintenanceOrdersModule {}
