import { Body, Controller, Get, Post } from "@nestjs/common";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type PartnerMigrationApplyResult,
  type PartnerMigrationPlan,
  type PartnerMigrationRestorePreview,
  type PartnerMigrationRestoreResult,
  type PartnerMigrationRunPreview,
} from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  PartnerMigrationApplyDto,
  PartnerMigrationPreviewDto,
  PartnerMigrationRestoreApplyDto,
} from "./dto/partner-migration.dto.js";
import { PartnerMigrationRunService } from "./partner-migration-run.service.js";
import { PartnerMigrationPlanService } from "./partner-migration.service.js";

/**
 * EGY PARTNERTÖRZS, EGYSZERI ÁTVEZETÉS (`settings.manage`: ugyanaz a jog, mint a duplikátum-listáé; új jog nem készül, a
 * jogosultság-változtatás zárolt kategória). A GET és a két `preview` CSAK OLVAS. Az írás (`apply`, `restore/apply`) a próba
 * lenyomatát kéri vissza, és ugyanazt a magot futtatja, mint a `partner:migrate` parancs. A lista neveket és adószámokat tartalmaz,
 * jogosult felhasználónak jelenik meg.
 */
@Controller("admin/partner-migration")
export class PartnerMigrationController {
  constructor(
    private readonly service: PartnerMigrationPlanService,
    private readonly run: PartnerMigrationRunService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  plan(): Promise<PartnerMigrationPlan> {
    return this.service.build();
  }

  @Post("preview")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  preview(
    @Body() input: PartnerMigrationPreviewDto,
  ): Promise<PartnerMigrationRunPreview> {
    return this.run.preview(input.binds);
  }

  @Post("apply")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  apply(
    @Body() input: PartnerMigrationApplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PartnerMigrationApplyResult> {
    return this.run.apply(input.fingerprint, input.binds, user.id);
  }

  @Post("restore/preview")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  restorePreview(): Promise<PartnerMigrationRestorePreview> {
    return this.run.restorePreview();
  }

  @Post("restore/apply")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  restoreApply(
    @Body() input: PartnerMigrationRestoreApplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PartnerMigrationRestoreResult> {
    return this.run.restoreApply(input.fingerprint, user.id);
  }
}
