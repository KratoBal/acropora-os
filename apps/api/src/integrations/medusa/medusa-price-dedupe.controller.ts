import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  MedusaPriceDedupeService,
  type PriceDedupeView,
} from "./medusa-price-dedupe.service.js";

const MAX_IDS = 100;
const MAX_ID_LENGTH = 200;

/**
 * The body gate is exactly `osProductIds` (a non-empty array of at most 100 non-empty strings) and the optional boolean `apply`.
 * A wider check would let a mistyped key silently turn an `apply` request into a plan, or the other way round.
 */
export function dedupeBody(body: unknown): { ids: string[]; apply: boolean } {
  const invalid = () =>
    new HttpException(
      "MEDUSA_PRICE_REPAIR_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid();
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== "osProductIds" && key !== "apply")
  )
    throw invalid();
  const ids = record.osProductIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_IDS ||
    ids.some(
      (id) =>
        typeof id !== "string" ||
        id.trim().length === 0 ||
        id.length > MAX_ID_LENGTH,
    )
  )
    throw invalid();
  if (record.apply !== undefined && typeof record.apply !== "boolean")
    throw invalid();
  return {
    ids: [...new Set((ids as string[]).map((id) => id.trim()))],
    apply: record.apply === true,
  };
}

/** An unreachable shop or a missing credential is not the caller's fault: 503, the code in the body. */
function toHttp(error: unknown): never {
  if (
    error instanceof MedusaConnectionError ||
    error instanceof MedusaConfigurationError
  )
    throw new HttpException(
      error instanceof MedusaConnectionError
        ? error.code
        : "MEDUSA_NOT_CONFIGURED",
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  throw error;
}

/**
 * THE TWO-HUF-PRICE REPAIR (acrobot 53861 and 53863). It WRITES to the shop, so it has three gates in a row: the environment switch
 * `MEDUSA_PRICE_REPAIR_ENABLED=true` (off by default: a closed switch is a 404, even for a user with the right), the permission
 * `SETTINGS_MANAGE` (owner and admin), and `apply: true` in the body (without it the answer is a plan). The rule itself and its
 * refusals are in `medusa-price-dedupe.ts`.
 */
@Controller("integrations/medusa/price-repair")
export class MedusaPriceDedupeController {
  constructor(private readonly service: MedusaPriceDedupeService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async repair(
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PriceDedupeView> {
    if (!this.service.enabled()) throw new NotFoundException();
    const { ids, apply } = dedupeBody(body);
    try {
      return await this.service.run(ids, apply, user.id);
    } catch (error) {
      return toHttp(error);
    }
  }
}
