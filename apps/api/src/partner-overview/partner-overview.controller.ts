import { Controller, Get, Header } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";

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
}
