import {
  Controller,
  Get,
  Inject,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";

import { ReefClubDatabase } from "./reefclub-database.js";
import {
  type ClientAddressDiag,
  clientAddressDiag,
  diagOpen,
} from "./reefclub-diag.js";
import {
  reefClubCallerAddress,
  trustedProxyHops,
} from "./reefclub-rate-limits.js";
import { ReefClubPublic } from "./reefclub.guard.js";

/**
 * GET /rc/v1/health: the process is up and its own database connection works.
 * The answer names no table and no version, because it is public. Only with
 * `REEFCLUB_DIAG_CLIENT_ADDRESS=true`, and then for the first hour of the
 * process only, it also shows the caller's computed address and the chain it
 * came from (`reefclub-diag.ts`).
 */
@Controller("rc/v1/health")
export class ReefClubHealthController {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  @ReefClubPublic()
  @Get()
  async health(
    @Req()
    request: {
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
    },
  ): Promise<{ status: "ok"; diag?: ClientAddressDiag }> {
    try {
      await this.database.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException();
    }
    if (!diagOpen()) return { status: "ok" };
    return {
      status: "ok",
      diag: clientAddressDiag(request, {
        callerAddress: reefClubCallerAddress(request),
        trustedProxyHops: trustedProxyHops(),
      }),
    };
  }
}
