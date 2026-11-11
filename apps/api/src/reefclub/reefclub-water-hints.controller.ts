import { Controller, Get, Param, Req } from "@nestjs/common";
import { CUSTOMER_RANGES_VERSION } from "@acropora/aquarium-calc";
import type { ReefClubWaterHints } from "@acropora/types";

import { ReefClubAquariumAccess } from "./reefclub-aquarium-access.js";
import { ReefClubRateLimits } from "./reefclub-rate-limits.js";
import {
  reefClubAccountOf as accountOf,
  type ReefClubRequest,
} from "./reefclub.guard.js";
import {
  ReefClubWaterHintsService,
  waterHintsEnabled,
} from "./reefclub-water-hints.service.js";

/** What the switched-off route answers: the shape of a real answer with nothing in it (the panel hides itself). */
const OFF: ReefClubWaterHints = {
  state: "OFF",
  registerVersion: CUSTOMER_RANGES_VERSION,
  disclaimer: null,
  productsState: "NONE",
  rows: [],
};

/**
 * GET /rc/v1/aquariums/:id/water-hints (card ce6c5cc9, V3.4 S3): READS ONLY. Switched off (`REEFCLUB_WATER_HINTS_ENABLED`, exactly
 * `true`, off by default) it answers `OFF` before anything is read. Switched on: the access function first (READ: the own aquarium
 * or a linked customer's; anything else is the one 404), then the limits per account and per aquarium, then the service. A GET
 * writes nothing, so a prefetch costs only the limit.
 */
@Controller("rc/v1/aquariums/:id")
export class ReefClubWaterHintsController {
  constructor(
    private readonly access: ReefClubAquariumAccess,
    private readonly hints: ReefClubWaterHintsService,
    private readonly limits: ReefClubRateLimits,
  ) {}

  @Get("water-hints")
  async waterHints(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<ReefClubWaterHints> {
    if (!waterHintsEnabled()) return OFF;
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "READ");
    this.limits.waterHintsByAccount.check(account);
    this.limits.waterHintsByAquarium.check(grant.aquariumId);
    return this.hints.forGrant(grant, new Date());
  }
}
