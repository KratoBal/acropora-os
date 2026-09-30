import { Module } from "@nestjs/common";

import { SimplePayGmailClient } from "./simplepay-gmail.client.js";
import { SimplePayGmailSyncScheduler } from "./simplepay-gmail-sync.scheduler.js";
import { SimplePayGmailSyncService } from "./simplepay-gmail-sync.service.js";
import { SimplePayMonthlyReportXlsx } from "./simplepay-monthly-report.xlsx.js";
import { SimplePaySettlementController } from "./simplepay-settlement.controller.js";
import { SimplePaySettlementRepository } from "./simplepay-settlement.repository.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

@Module({
  controllers: [SimplePaySettlementController],
  providers: [
    SimplePaySettlementRepository,
    SimplePaySettlementService,
    SimplePayMonthlyReportXlsx,
    SimplePayGmailClient,
    SimplePayGmailSyncService,
    SimplePayGmailSyncScheduler,
  ],
})
export class SimplePaySettlementModule {}
