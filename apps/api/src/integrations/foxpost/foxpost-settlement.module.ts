import { Module } from "@nestjs/common";

import { UnasImportModule } from "../../imports/unas/unas-import.module.js";
import { FoxpostGmailClient } from "./foxpost-gmail.client.js";
import { FoxpostMonthlyReportXlsx } from "./foxpost-monthly-report.xlsx.js";
import { FoxpostSettlementController } from "./foxpost-settlement.controller.js";
import { FoxpostSettlementParser } from "./foxpost-settlement.parser.js";
import { FoxpostSettlementRepository } from "./foxpost-settlement.repository.js";
import { FoxpostSettlementScheduler } from "./foxpost-settlement.scheduler.js";
import { FoxpostSettlementService } from "./foxpost-settlement.service.js";

@Module({
  imports: [UnasImportModule],
  controllers: [FoxpostSettlementController],
  providers: [
    FoxpostGmailClient,
    FoxpostSettlementParser,
    FoxpostMonthlyReportXlsx,
    FoxpostSettlementRepository,
    FoxpostSettlementService,
    FoxpostSettlementScheduler,
  ],
})
export class FoxpostSettlementModule {}
