import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  MedusaPriceAuditService,
  PRICE_AUDIT_DEFAULT_LIMIT,
  PRICE_AUDIT_MAX_LIMIT,
  type PriceAuditQuery,
  type PriceAuditView,
} from "./medusa-price-audit.service.js";

const MAX_FROM_LENGTH = 200;

/**
 * The query is strict, like the pickup adoption body: only `limit`, `from` and `all` exist, and anything else is a 400 (a
 * mistyped key would otherwise silently run the default page and the caller would think it read what it asked for).
 */
export function priceAuditQuery(raw: unknown): PriceAuditQuery {
  const invalid = () =>
    new HttpException(
      "MEDUSA_PRICE_AUDIT_INPUT_INVALID",
      HttpStatus.BAD_REQUEST,
    );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const record = raw as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "limit" && key !== "from" && key !== "all",
    )
  )
    throw invalid();

  let limit = PRICE_AUDIT_DEFAULT_LIMIT;
  if (record.limit !== undefined) {
    if (typeof record.limit !== "string" || !/^[0-9]{1,4}$/.test(record.limit))
      throw invalid();
    limit = Number(record.limit);
    if (limit < 1 || limit > PRICE_AUDIT_MAX_LIMIT) throw invalid();
  }
  let from: string | null = null;
  if (record.from !== undefined) {
    if (
      typeof record.from !== "string" ||
      record.from.trim().length === 0 ||
      record.from.length > MAX_FROM_LENGTH
    )
      throw invalid();
    from = record.from.trim();
  }
  let all = false;
  if (record.all !== undefined) {
    if (record.all !== "true" && record.all !== "false") throw invalid();
    all = record.all === "true";
  }
  return { limit, from, all };
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
 * THE READ-ONLY PRICE AUDIT (acrobot 53851), the same permission as the projection queue status: it only reads (the shop's price
 * rows through the admin GET, the OS products through findMany) and it writes nothing, on the OS or on the shop. A page is at
 * most 300 products; `nextFrom` is the cursor for the next page.
 */
@Controller("health/medusa-price-audit")
export class MedusaPriceAuditController {
  constructor(private readonly service: MedusaPriceAuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  async audit(@Query() query: unknown): Promise<PriceAuditView> {
    const parsed = priceAuditQuery(query);
    try {
      return await this.service.run(parsed);
    } catch (error) {
      return toHttp(error);
    }
  }
}
