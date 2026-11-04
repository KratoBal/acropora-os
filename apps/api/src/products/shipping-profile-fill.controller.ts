import { Body, Controller, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { IsString, Matches } from "class-validator";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { ShippingProfileFillService } from "./shipping-profile-fill.service.js";

export class ShippingFillApplyDto {
  @IsString() @Matches(/^[0-9a-f]{64}$/) fingerprint!: string;
}

/**
 * A szállítási jelzők egyszeri feltöltése (a82ed229): próba és írás, a beállítások jogával, mint a partner-átvezetés.
 * A próba csak olvas; az írás a próba lenyomatával megy.
 */
@Controller("products/shipping-profile-fill")
export class ShippingProfileFillController {
  constructor(private readonly service: ShippingProfileFillService) {}

  @Post("preview")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  preview() {
    return this.service.preview();
  }

  @Post("apply")
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  apply(
    @Body() input: ShippingFillApplyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.apply(input.fingerprint, user.id);
  }
}
