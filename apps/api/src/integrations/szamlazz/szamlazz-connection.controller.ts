import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Put,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { SzamlazzConnectionService } from "./szamlazz-connection.service.js";
import {
  SzamlazzConnectionError,
  isSzamlazzConnectionErrorCode,
} from "./szamlazz-connection.types.js";

/**
 * A bemenet SZŰK kapuja -- a Medusa `candidateApiKey` mintája: pontosan egy
 * mezőt enged, semmi mást.
 */
function candidateAgentKey(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpException(
      "SZAMLAZZ_CREDENTIAL_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  const keys = Object.keys(body);
  const agentKey = (body as Record<string, unknown>).agentKey;
  if (
    keys.length !== 1 ||
    keys[0] !== "agentKey" ||
    typeof agentKey !== "string" ||
    agentKey.trim().length === 0 ||
    agentKey.length > 4096
  )
    throw new HttpException(
      "SZAMLAZZ_CREDENTIAL_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  return agentKey;
}

function toHttp(error: unknown): never {
  if (error instanceof SzamlazzConnectionError) {
    if (error.code === "SZAMLAZZ_CONNECTION_COOLDOWN")
      throw new HttpException(error.code, HttpStatus.TOO_MANY_REQUESTS);
    if (isSzamlazzConnectionErrorCode(error.code))
      throw new HttpException(error.code, HttpStatus.BAD_REQUEST);
  }
  throw error;
}

/**
 * A Számlázz.hu Agent Key beállítása (ADR-014, 4. szelet).
 *
 * A meglévő `SETTINGS_MANAGE` jogot használja, új jogosultsági fogalom
 * nélkül -- ugyanaz a minta, mint a Medusa kapcsolat vezérlőjénél.
 *
 * Amit ez a vezérlő SOHA nem ad vissza: a kulcsot. Nincs "Teszt" végpont
 * sem, szemben a Medusáéval -- lásd szamlazz-connection.service.ts.
 */
@Controller("integrations/szamlazz/connection")
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class SzamlazzConnectionController {
  constructor(private readonly service: SzamlazzConnectionService) {}

  @Get()
  get() {
    return this.service.getView();
  }

  @Put("credential")
  async replaceCredential(
    @Body() input: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      return await this.service.replaceCredential(
        candidateAgentKey(input),
        user.id,
        new Date(),
      );
    } catch (error) {
      return toHttp(error);
    }
  }

  @Delete("credential")
  async disable(@CurrentUser() user: AuthenticatedUser) {
    try {
      return await this.service.disable(user.id, new Date());
    } catch (error) {
      return toHttp(error);
    }
  }
}
