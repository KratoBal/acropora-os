import { Body, Controller, Get, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  RentalSettingsService,
  SaveRentalSettingsDto,
} from "./rental-settings.js";

// in its own *.controller.ts: the route guards (mobile-api-routes) read the routes from those files only
/** Settings > Bérleti szerződés: the same right as the other Settings master data (`settings.manage`). */
@Controller("rental-settings")
export class RentalSettingsController {
  constructor(private readonly service: RentalSettingsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  get() {
    return this.service.get();
  }

  @Put()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  save(
    @Body() input: SaveRentalSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.save(input, user.id);
  }
}
