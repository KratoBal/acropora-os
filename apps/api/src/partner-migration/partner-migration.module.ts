import { Module } from "@nestjs/common";

import { PartnerDuplicateRepository } from "../partner-duplicates/partner-duplicate-report.service.js";
import { PartnerMigrationController } from "./partner-migration.controller.js";
import {
  PartnerMigrationRunRepository,
  PartnerMigrationRunService,
} from "./partner-migration-run.service.js";
import {
  PartnerMigrationPlanService,
  PartnerMigrationSuppliers,
} from "./partner-migration.service.js";

/** Egy partnertörzs, egyszeri átvezetés: a partnerek terve, és a futtatás (próba, írás, visszaállítás) a lenyomattal. */
@Module({
  controllers: [PartnerMigrationController],
  providers: [
    PartnerDuplicateRepository,
    PartnerMigrationSuppliers,
    PartnerMigrationPlanService,
    PartnerMigrationRunRepository,
    PartnerMigrationRunService,
  ],
})
export class PartnerMigrationModule {}
