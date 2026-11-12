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
  CreateManufacturerClaimDto,
  ManufacturerClaimListQueryDto,
  SetManufacturerClaimStatusDto,
  UpdateManufacturerClaimDto,
} from "./manufacturer-claims.dto.js";
import {
  type ManufacturerClaimView,
  ManufacturerClaimsService,
} from "./manufacturer-claims.service.js";

/**
 * THE MANUFACTURER CLAIMS (T5.3). They serve content writing, so the rights are the content ones:
 * reading is `content.view`; recording, editing, checking and archiving are `content.manage`,
 * internal only (the service). "Independently confirmed" additionally needs a person with
 * `content.approve` (the service, `statusChangeRefusal`).
 */
@Controller()
export class ManufacturerClaimsController {
  constructor(private readonly claims: ManufacturerClaimsService) {}

  @Get("products/:id/manufacturer-claims")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  async forProduct(
    @Param("id") id: string,
    @Query() query: ManufacturerClaimListQueryDto,
  ): Promise<{ items: ManufacturerClaimView[]; truncated: boolean }> {
    return this.claims.listForProduct(id, query.includeArchived === "true");
  }

  @Post("products/:id/manufacturer-claims")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  create(
    @Param("id") id: string,
    @Body() body: CreateManufacturerClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    return this.claims.create(id, body, user);
  }

  /** The review queue (`?status=UNVERIFIED`) and any filtered list: dosing and safety first. */
  @Get("manufacturer-claims")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  async list(
    @Query() query: ManufacturerClaimListQueryDto,
  ): Promise<{ items: ManufacturerClaimView[]; truncated: boolean }> {
    return this.claims.list({
      productId: query.productId,
      status: query.status,
      claimType: query.claimType,
      includeArchived: query.includeArchived === "true",
    });
  }

  @Patch("manufacturer-claims/:claimId")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  update(
    @Param("claimId") claimId: string,
    @Body() body: UpdateManufacturerClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    return this.claims.update(claimId, body, user);
  }

  @Post("manufacturer-claims/:claimId/status")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  setStatus(
    @Param("claimId") claimId: string,
    @Body() body: SetManufacturerClaimStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    return this.claims.setStatus(claimId, body, user);
  }

  @Delete("manufacturer-claims/:claimId")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  async archive(
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.claims.archive(claimId, user);
  }

  @Get("manufacturer-claims/:claimId/events")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  async events(@Param("claimId") claimId: string) {
    return { items: await this.claims.events(claimId) };
  }
}
