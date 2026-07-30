import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Put,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { NavConnectionService } from "./nav-connection.service.js";
import { NavConnectionError } from "./nav-connection.types.js";
import { normalizeNavCredentialInput } from "./nav-credentials.service.js";

function candidateCredentials(body: unknown) {
  try {
    return normalizeNavCredentialInput(body);
  } catch (error) {
    if (
      error instanceof NavConnectionError &&
      error.code === "NAV_CREDENTIAL_INPUT_INVALID"
    )
      throw new HttpException(
        "NAV_CREDENTIAL_INPUT_INVALID",
        HttpStatus.BAD_REQUEST,
      );
    throw error;
  }
}

@Controller("integrations/nav/connection")
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class NavConnectionController {
  constructor(private readonly service: NavConnectionService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Put("credential")
  replaceCredential(
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.replaceCredential(candidateCredentials(input), user.id);
  }

  @Post("test")
  testStoredCredential(@CurrentUser() user: AuthenticatedUser) {
    return this.service.testStoredCredential(user.id);
  }

  @Delete("credential")
  disable(@CurrentUser() user: AuthenticatedUser) {
    return this.service.disable(user.id);
  }
}
