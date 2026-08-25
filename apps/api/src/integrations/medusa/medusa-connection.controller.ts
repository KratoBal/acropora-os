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
import { MedusaConnectionService } from "./medusa-connection.service.js";
import {
  MedusaConnectionError,
  isMedusaConnectionErrorCode,
} from "./medusa-connection.types.js";

/**
 * A bemenet SZŰK kapuja.
 *
 * Pontosan egy mezőt enged, és semmi mást: egy szélesebb ellenőrzés itt azt
 * jelentené, hogy a kérés más mezői csendben elvesznek, és a hívó azt hinné,
 * beállított valamit. A hossz-korlát nem a Medusa kulcsáról szól, hanem arról,
 * hogy egy elgépelt beillesztés ne juthasson el a titkosításig.
 */
function candidateApiKey(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpException(
      "MEDUSA_CREDENTIAL_INPUT_INVALID",
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
      "MEDUSA_CREDENTIAL_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  return apiKey;
}

/**
 * A hibák HTTP alakja. A visszatartás külön kódot kap, mert a teendő más:
 * várni kell, nem javítani.
 */
function toHttp(error: unknown): never {
  if (error instanceof MedusaConnectionError) {
    if (error.code === "MEDUSA_CONNECTION_COOLDOWN")
      throw new HttpException(error.code, HttpStatus.TOO_MANY_REQUESTS);
    if (isMedusaConnectionErrorCode(error.code))
      throw new HttpException(error.code, HttpStatus.BAD_REQUEST);
  }
  throw error;
}

/**
 * A Medusa kapcsolat beállítása.
 *
 * A jogosultság OSZTÁLY szinten áll, nem végpontonként: egy új végpont így nem
 * tud véletlenül védtelenül maradni. A meglévő `SETTINGS_MANAGE` jogot
 * használja, új jogosultsági fogalom nélkül.
 *
 * Amit ez a vezérlő SOHA nem ad vissza: a kulcsot. Nincs olyan végpontja, ami
 * kiolvasná, és a nézet is csak maszkolt jelzést tartalmaz.
 */
@Controller("integrations/medusa/connection")
@RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
export class MedusaConnectionController {
  constructor(private readonly service: MedusaConnectionService) {}

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
        candidateApiKey(input),
        user.id,
        new Date(),
      );
    } catch (error) {
      return toHttp(error);
    }
  }

  @Post("test")
  async testStoredCredential() {
    try {
      return await this.service.testStoredCredential(new Date());
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
