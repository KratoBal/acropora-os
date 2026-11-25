import { Body, Controller, Get, Header, HttpCode, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";

import { PartnerSeenDto } from "./partner-overview.dto.js";
import { PartnerOverviewService } from "./partner-overview.service.js";

/** The partner portal's overview (card 28f31715): the same right as the lists it is built from. */
@Controller("service/partner-overview")
export class PartnerOverviewController {
  constructor(private readonly service: PartnerOverviewService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.service.overview(user);
  }

  /**
   * THE PARTNER OPENED A LIST (PR 2, "Újdonságok"): only the partner's own last-visit time is written, nothing of the shop's data,
   * so it stands behind the same right as the list it marks.
   */
  @Post("seen")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVICE_VIEW)
  async seen(
    @Body() body: PartnerSeenDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ seen: true }> {
    await this.service.markSeen(user, body.area);
    // a JSON answer: the portal's client reads every answer as JSON
    return { seen: true };
  }
}
