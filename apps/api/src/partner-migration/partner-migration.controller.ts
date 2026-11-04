import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS, type PartnerMigrationPlan } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { PartnerMigrationPlanService } from "./partner-migration.service.js";

/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS: A PARTNEREK TERVE (CSAK OLVASÁS, `settings.manage`: ugyanaz a jog, mint a
 * duplikátum-listáé). A lista neveket és adószámokat tartalmaz, jogosult felhasználónak jelenik meg.
 */
@Controller("admin/partner-migration")
export class PartnerMigrationController {
  constructor(private readonly service: PartnerMigrationPlanService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  plan(): Promise<PartnerMigrationPlan> {
    return this.service.build();
  }
}
