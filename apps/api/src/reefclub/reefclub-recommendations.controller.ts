import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from "@nestjs/common";

import { ReefClubAquariumAccess } from "./reefclub-aquarium-access.js";
import {
  ReefClubAnswerDto,
  ReefClubRecommendDto,
  ReefClubRecordDoseDto,
} from "./reefclub-recommendation.dto.js";
import {
  type ReefClubDoseItem,
  type ReefClubDoseResult,
  ReefClubDosesService,
} from "./reefclub-doses.service.js";
import {
  type ReefClubRecommendationAnswer,
  type ReefClubRecommendationItem,
  ReefClubRecommendationService,
} from "./reefclub-recommendation.service.js";
import { ReefClubRateLimits } from "./reefclub-rate-limits.js";
import {
  reefClubAccountOf as accountOf,
  type ReefClubRequest,
} from "./reefclub.guard.js";

/**
 * /rc/v1/aquariums/:id/recommendations and /doses (plan v6.1, 3.4 and 6;
 * slice 8). THE ONE DEVIATION FROM THE PLAN'S TABLE (acrobot, 2026-10-21): the
 * plan lists a GET for "the recommendation computed for an occasion". Issuing a
 * dose writes the log and RESERVES the daily limit, and a GET must not do that
 * (a browser's prefetch or a link checker would take the customer's limit
 * without the customer knowing), and the engine computes from the LATEST
 * measurement, so a recommendation "for an old occasion" would mislead. So:
 *
 *   POST  .../recommendations              {parameter}: issues one, or shows the open one
 *   GET   .../recommendations              reads, writes nothing
 *   POST  .../recommendations/:recId/answer  the answer; the dose first, then the status
 *   POST  .../doses                        a given dose as a fact (clientOperationId required)
 *   GET   .../doses                        reads, writes nothing
 *
 * EVERY ROUTE ASKS THE ACCESS FUNCTION FIRST (READ: the own aquarium or a
 * linked customer's; anything else is the one 404), then the limits per
 * account and per aquarium, then the service. The recommendation id is looked
 * up UNDER the route's aquarium and the asking account (only the issuing
 * account answers it): an id of another aquarium or account is the same
 * "not open" answer. Writes go through the global guard's CSRF check like
 * every ReefClub write.
 */
@Controller("rc/v1/aquariums/:id")
export class ReefClubRecommendationsController {
  constructor(
    private readonly access: ReefClubAquariumAccess,
    private readonly recommendations: ReefClubRecommendationService,
    private readonly doses: ReefClubDosesService,
    private readonly limits: ReefClubRateLimits,
  ) {}

  @Post("recommendations")
  async recommend(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Body() body: ReefClubRecommendDto,
  ): Promise<ReefClubRecommendationAnswer> {
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "READ");
    this.limits.recommendationByAccount.check(account);
    this.limits.recommendationByAquarium.check(grant.aquariumId);
    return this.recommendations.recommend(account, id, body.parameter);
  }

  @Get("recommendations")
  list(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<{ items: ReefClubRecommendationItem[] }> {
    return this.recommendations.list(accountOf(request), id);
  }

  @Post("recommendations/:recId/answer")
  async answer(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Param("recId") recId: string,
    @Body() body: ReefClubAnswerDto,
  ): Promise<{ doseId: string | null; warnings: unknown[] }> {
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "READ");
    this.limits.doseByAccount.check(account);
    this.limits.doseByAquarium.check(grant.aquariumId);
    return recorded(
      await this.doses.answer(account, id, recId, {
        answer: body.answer,
        amount: body.amount ?? null,
        administeredAt: body.administeredAt
          ? new Date(body.administeredAt)
          : undefined,
        confirmed: body.confirmed ?? false,
        clientOperationId: body.clientOperationId ?? null,
      }),
    );
  }

  @Post("doses")
  async record(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
    @Body() body: ReefClubRecordDoseDto,
  ): Promise<{ doseId: string | null; warnings: unknown[] }> {
    const account = accountOf(request);
    const grant = await this.access.aquariumForAccount(account, id, "READ");
    this.limits.doseByAccount.check(account);
    this.limits.doseByAquarium.check(grant.aquariumId);
    return recorded(
      await this.doses.record(account, id, {
        parameter: body.parameter,
        productId: body.productId,
        amount: body.amount,
        unit: body.unit,
        administeredAt: new Date(body.administeredAt),
        recommendationId: body.recommendationId ?? null,
        confirmed: body.confirmed ?? false,
        clientOperationId: body.clientOperationId,
      }),
    );
  }

  @Get("doses")
  listDoses(
    @Req() request: ReefClubRequest,
    @Param("id") id: string,
  ): Promise<{ items: ReefClubDoseItem[] }> {
    return this.doses.list(accountOf(request), id);
  }
}

/** The service's result as a response: a refusal is a 400, a missing confirmation a 409. */
function recorded(result: ReefClubDoseResult): {
  doseId: string | null;
  warnings: unknown[];
} {
  if (result.outcome === "REFUSED")
    throw new BadRequestException({
      message: result.message,
      code: result.code,
    });
  if (result.outcome === "NEEDS_CONFIRMATION")
    throw new ConflictException({
      message: result.message,
      code: "NEEDS_CONFIRMATION",
      recommendedAmount: result.recommendedAmount,
    });
  return { doseId: result.doseId, warnings: result.warnings };
}
