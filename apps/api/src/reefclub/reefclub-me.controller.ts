import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
} from "@nestjs/common";

import {
  ReefClubAppleLinkDto,
  ReefClubGoogleLinkDto,
  ReefClubUpdateMeDto,
} from "./reefclub-auth.dto.js";
import {
  type ReefClubMe,
  ReefClubAuthService,
} from "./reefclub-auth.service.js";
import { ReefClubExternalAuthService } from "./reefclub-external-auth.service.js";
import {
  reefClubCallerAddress,
  ReefClubRateLimits,
} from "./reefclub-rate-limits.js";
import {
  reefClubAccountOf as accountOf,
  type ReefClubRequest,
} from "./reefclub.guard.js";

/**
 * GET and PATCH /rc/v1/me (plan v6.1, 3.2). The account is the session's,
 * never a field of the request (plan 3.1: the owner never comes from the body).
 * POST /rc/v1/me/identities/{google,apple} adds a sign-in method (slice 3).
 * DELETE /rc/v1/me (account deletion) is slice 6.
 */
@Controller("rc/v1/me")
export class ReefClubMeController {
  constructor(
    private readonly auth: ReefClubAuthService,
    private readonly external: ReefClubExternalAuthService,
    private readonly limits: ReefClubRateLimits,
  ) {}

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

  /**
   * Adds Google to the signed-in account (plan 3.2: the owner of an existing
   * account adds it here; nothing is linked by e-mail).
   */
  @Post("identities/google")
  @HttpCode(204)
  async linkGoogle(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubGoogleLinkDto,
  ): Promise<void> {
    this.limits.externalByAddress.check(reefClubCallerAddress(request));
    await this.external.link(accountOf(request), "GOOGLE", body.idToken, {});
  }

  @Post("identities/apple")
  @HttpCode(204)
  async linkApple(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubAppleLinkDto,
  ): Promise<void> {
    this.limits.externalByAddress.check(reefClubCallerAddress(request));
    await this.external.link(accountOf(request), "APPLE", body.idToken, {
      nonce: body.nonce,
    });
  }
}
