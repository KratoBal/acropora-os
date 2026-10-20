import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  CreateDoseEffectDto,
  DoseEffectListQueryDto,
  UpdateDoseEffectDto,
  VerifyDoseEffectDto,
} from "./dose-effects.dto.js";
import { type DoseProjectionStatus } from "./dose-projection.rules.js";
import { DoseProjectionService } from "./dose-projection.service.js";
import {
  type DoseEffectSuggestion,
  type DoseEffectView,
  DoseEffectsService,
} from "./dose-effects.service.js";

/**
 * THE PRODUCT DOSE LIST (ReefClub plan v6.1, 6.2; slice 7). Reading is the
 * product view right; recording, editing, checking and archiving are the
 * product manage right, internal only (the service).
 */
@Controller()
export class DoseEffectsController {
  constructor(
    private readonly doseEffects: DoseEffectsService,
    private readonly projection: DoseProjectionService,
  ) {}

  /**
   * After every change to the list the projection for the ReefClub is rebuilt
   * IN FULL (never one row), in the background: the answer to the colleague
   * does not wait for it, and a failure is a run record the status shows.
   */
  private readonly rebuildAfter = <T>(result: T): T => {
    void this.projection.rebuild("EDIT");
    return result;
  };

  @Get("products/:id/dose-effects")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  async forProduct(
    @Param("id") id: string,
  ): Promise<{ items: DoseEffectView[] }> {
    return { items: await this.doseEffects.listForProduct(id) };
  }

  @Get("products/:id/dose-effects/suggestion")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  suggestion(@Param("id") id: string): Promise<DoseEffectSuggestion> {
    return this.doseEffects.suggestion(id);
  }

  @Post("products/:id/dose-effects")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  create(
    @Param("id") id: string,
    @Body() body: CreateDoseEffectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DoseEffectView> {
    return this.doseEffects.create(id, body, user).then(this.rebuildAfter);
  }

  /**
   * THE STATE OF THE REEFCLUB PROJECTION (path B): the last successful full
   * build, the last failure with its text, and whether the projection is stale
   * (no dose is given from a stale one). The control panel reads this.
   */
  @Get("dose-effects/projection")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  projectionStatus(): Promise<DoseProjectionStatus> {
    return this.projection.status();
  }

  @Get("dose-effects")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  async list(
    @Query() query: DoseEffectListQueryDto,
  ): Promise<{ items: DoseEffectView[] }> {
    return {
      items: await this.doseEffects.list({
        parameterCode: query.parameterCode,
        includeArchived: query.includeArchived === "true",
      }),
    };
  }

  @Patch("dose-effects/:effectId")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  update(
    @Param("effectId") effectId: string,
    @Body() body: UpdateDoseEffectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DoseEffectView> {
    return this.doseEffects
      .update(effectId, body, user)
      .then(this.rebuildAfter);
  }

  @Post("dose-effects/:effectId/verify")
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  verify(
    @Param("effectId") effectId: string,
    @Body() body: VerifyDoseEffectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DoseEffectView> {
    return this.doseEffects
      .verify(effectId, body, user)
      .then(this.rebuildAfter);
  }

  @Delete("dose-effects/:effectId")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE)
  async archive(
    @Param("effectId") effectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.doseEffects.archive(effectId, user);
    this.rebuildAfter(undefined);
  }

  @Get("dose-effects/:effectId/versions")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  async versions(@Param("effectId") effectId: string) {
    return { items: await this.doseEffects.versions(effectId) };
  }
}
