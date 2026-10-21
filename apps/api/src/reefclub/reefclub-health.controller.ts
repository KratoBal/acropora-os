import {
  Controller,
  Get,
  Header,
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
 * `REEFCLUB_DIAG_CLIENT_ADDRESS_UNTIL` (an absolute, near expiry), it also
 * shows the caller's computed address and the chain it came from
 * (`reefclub-diag.ts`). Every answer is `no-store`.
 */
@Controller("rc/v1/health")
export class ReefClubHealthController {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  @ReefClubPublic()
  @Get()
  // The diag answer carries the caller's address, which is personal data: nothing on the way may keep it.
  @Header("Cache-Control", "no-store")
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
