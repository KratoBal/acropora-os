import { Body, Controller, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { AccountSettingsService } from "./account-settings.service.js";
import {
  ChangeOwnPasswordDto,
  ChangeOwnSigningCodeDto,
} from "./dto/account-settings.dto.js";

@Controller("account")
export class AccountSettingsController {
  constructor(private readonly service: AccountSettingsService) {}

  @Post("password")
  changePassword(
    @Body() input: ChangeOwnPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changePassword(input, user.id);
  }

  @Post("signing-code")
  changeSigningCode(
    @Body() input: ChangeOwnSigningCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changeSigningCode(input, user.id);
  }
}
