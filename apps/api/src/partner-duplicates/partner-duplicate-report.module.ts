import { Module } from "@nestjs/common";

import { PartnerDuplicateReportController } from "./partner-duplicate-report.controller.js";
import {
  PartnerDuplicateReportService,
  PartnerDuplicateRepository,
} from "./partner-duplicate-report.service.js";
import { PartnerDuplicateReportScheduler } from "./partner-duplicate-report.scheduler.js";

/** Egy partnertörzs, 1. lépés: a duplikátumok csak olvasó mérése (naplósor és admin végpont). */
@Module({
  controllers: [PartnerDuplicateReportController],
  providers: [
    PartnerDuplicateRepository,
    PartnerDuplicateReportService,
    PartnerDuplicateReportScheduler,
  ],
})
export class PartnerDuplicateReportModule {}
