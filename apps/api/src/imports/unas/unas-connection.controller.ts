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
import { UnasConnectionService } from "./unas-connection.service.js";

function candidateApiKey(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpException(
      "UNAS_CREDENTIAL_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  const keys = Object.keys(body);
  const apiKey = (body as Record<string, unknown>).apiKey;
  if (
    keys.length !== 1 ||
    keys[0] !== "apiKey" ||
    typeof apiKey !== "string" ||
    apiKey.trim().length === 0 ||
    apiKey.length > 4096
  )
    throw new HttpException(
      "UNAS_CREDENTIAL_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  return apiKey;
}

@Controller("integrations/unas/connection")
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class UnasConnectionController {
  constructor(private readonly service: UnasConnectionService) {}

  @Get()
  get() {
    return this.service.get();
  }

  @Put("credential")
  replaceCredential(
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.replaceCredential(candidateApiKey(input), user.id);
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
