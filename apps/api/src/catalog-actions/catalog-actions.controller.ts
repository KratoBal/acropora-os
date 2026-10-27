import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CatalogActionsService } from "./catalog-actions.service.js";

/**
 * THE CATALOG OPERATIONS' BUTTONS (Márkák page). The right sits on the CLASS,
 * as on the Medusa connection: `SETTINGS_MANAGE`, so a new endpoint cannot be
 * left unguarded. The environment switch is the service's: off, everything but
 * the overview is 404, and the overview says `enabled: false`.
 */
@Controller("catalog-actions")
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class CatalogActionsController {
  constructor(private readonly service: CatalogActionsService) {}

  @Get()
  overview() {
    return this.service.overview();
  }

  @Get("runs/:id")
  run(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post(":kind/plan")
  plan(@Param("kind") kind: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.plan(kind, user.id);
  }

  @Post(":kind/apply")
  apply(
    @Param("kind") kind: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const planRunId =
      body && typeof body === "object"
        ? (body as { planRunId?: unknown }).planRunId
        : undefined;
    return this.service.apply(kind, planRunId, user.id);
  }
}
