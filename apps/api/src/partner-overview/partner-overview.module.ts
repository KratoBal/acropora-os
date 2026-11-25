import { Module } from "@nestjs/common";

import { CompletionCertificatesModule } from "../completion-certificates/completion-certificates.module.js";
import { MaintenanceOrdersModule } from "../maintenance-orders/maintenance-orders.module.js";
import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { WorksheetsModule } from "../worksheets/worksheets.module.js";

import { PartnerOverviewController } from "./partner-overview.controller.js";
import { PartnerOverviewService } from "./partner-overview.service.js";
import { PartnerSeenRepository } from "./partner-seen.repository.js";

@Module({
  imports: [
    ServiceJobsModule,
    WorksheetsModule,
    CompletionCertificatesModule,
    MaintenanceOrdersModule,
  ],
  controllers: [PartnerOverviewController],
  providers: [PartnerOverviewService, PartnerSeenRepository],
})
export class PartnerOverviewModule {}
