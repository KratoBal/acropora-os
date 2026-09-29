import { Module } from "@nestjs/common";

import { GlsGmailClient } from "./gls-gmail.client.js";
import { GlsGmailSyncScheduler } from "./gls-gmail-sync.scheduler.js";
import { GlsGmailSyncService } from "./gls-gmail-sync.service.js";
import { GlsMonthlyReportXlsx } from "./gls-monthly-report.xlsx.js";
import { GlsSettlementController } from "./gls-settlement.controller.js";
import { GlsSettlementRepository } from "./gls-settlement.repository.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

@Module({
  controllers: [GlsSettlementController],
  providers: [
    GlsSettlementRepository,
    GlsSettlementService,
    GlsMonthlyReportXlsx,
    GlsGmailClient,
    GlsGmailSyncService,
    GlsGmailSyncScheduler,
  ],
})
export class GlsSettlementModule {}
