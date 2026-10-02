import { Body, Controller, Delete, Get, Put, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { DashboardWidgetsService } from "./dashboard-widgets.service.js";
import { DashboardService } from "./dashboard.service.js";

/**
 * Every route needs `dashboard.view`; each widget's own permission is checked
 * again inside `DashboardWidgetsService`, per widget.
 */
@Controller("dashboard")
@RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly widgets: DashboardWidgetsService,
  ) {}

  @Get("summary")
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user);
  }

  /** The user's layout (stored, else the role preset) and what they may add. */
  @Get("layout")
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  layout(@CurrentUser() user: AuthenticatedUser) {
    return this.widgets.layout(user);
  }

  @Put("layout")
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  saveLayout(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.widgets.saveLayout(user, body);
  }

  /** Back to the role preset. */
  @Delete("layout")
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  resetLayout(@CurrentUser() user: AuthenticatedUser) {
    return this.widgets.resetLayout(user);
  }

  /** `?ids=tasks,expected-arrivals`: the data of those widgets, in one call. */
  @Get("widgets")
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  widgetData(
    @CurrentUser() user: AuthenticatedUser,
    @Query("ids") ids?: string,
  ) {
    const requested = (ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return this.widgets.widgets(user, requested);
  }
}
