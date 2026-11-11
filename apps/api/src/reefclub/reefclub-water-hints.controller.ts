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
 * GET /rc/v1/aquariums/:id/water-hints (card ce6c5cc9, V3.4 S3): READS ONLY. THE ACCESS FUNCTION FIRST, whether the switch is on or not
 * (READ: the own aquarium or a linked customer's; anything else is the one 404, byte for byte like every aquarium-id route). Then the
 * switch (`REEFCLUB_WATER_HINTS_ENABLED`, exactly `true`, off by default): off, it answers `OFF` before anything else is read and
 * before a limit is used. On: the limits per account and per aquarium, then the service. A GET writes nothing, so a prefetch costs
 * only the limit.
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
    const account = accountOf(request);
    // THE ACCESS FUNCTION FIRST, SWITCH OR NOT: every aquarium-id route answers a foreign or missing id with the one 404, byte for byte
    // (plan 5.2/1: the integration spec sweeps every id route with another account's session). A switched-off route that answered OFF
    // before this would be the one route that does not.
    const grant = await this.access.aquariumForAccount(account, id, "READ");
    if (!waterHintsEnabled()) return OFF;
    this.limits.waterHintsByAccount.check(account);
    this.limits.waterHintsByAquarium.check(grant.aquariumId);
    return this.hints.forGrant(grant, new Date());
  }
}
