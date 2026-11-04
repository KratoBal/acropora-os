import { Module } from "@nestjs/common";

import { PartnerDuplicateRepository } from "../partner-duplicates/partner-duplicate-report.service.js";
import { PartnerMigrationController } from "./partner-migration.controller.js";
import {
  PartnerMigrationPlanService,
  PartnerMigrationSuppliers,
} from "./partner-migration.service.js";

/** Egy partnertörzs, egyszeri átvezetés: a partnerek terve, csak olvasva. */
@Module({
  controllers: [PartnerMigrationController],
  providers: [
    PartnerDuplicateRepository,
    PartnerMigrationSuppliers,
    PartnerMigrationPlanService,
  ],
})
export class PartnerMigrationModule {}
