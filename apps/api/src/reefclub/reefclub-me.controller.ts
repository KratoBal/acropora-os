import { Body, Controller, Get, Patch, Req } from "@nestjs/common";

import { ReefClubUpdateMeDto } from "./reefclub-auth.dto.js";
import {
  type ReefClubMe,
  ReefClubAuthService,
} from "./reefclub-auth.service.js";
import type { ReefClubRequest } from "./reefclub.guard.js";

/**
 * GET and PATCH /rc/v1/me (plan v6.1, 3.2). The account is the session's,
 * never a field of the request (plan 3.1: the owner never comes from the body).
 * DELETE /rc/v1/me (account deletion) is slice 6.
 */
@Controller("rc/v1/me")
export class ReefClubMeController {
  constructor(private readonly auth: ReefClubAuthService) {}

  @Get()
  me(@Req() request: ReefClubRequest): Promise<ReefClubMe> {
    return this.auth.me(accountOf(request));
  }

  @Patch()
  update(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubUpdateMeDto,
  ): Promise<ReefClubMe> {
    return this.auth.updateMe(accountOf(request), body.notifyOnRelease);
  }
}

function accountOf(request: ReefClubRequest): string {
  // The guard sets it on every non-public route; a missing one is a wiring
  // fault, and it must not fall through to some default account.
  if (!request.reefClubAccountId)
    throw new Error("ReefClub route reached without a ReefClub session.");
  return request.reefClubAccountId;
}
