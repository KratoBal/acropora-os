import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import type { CookieResponse } from "../auth/cookie.util.js";
import { ReefClubAccountDeletionService } from "./reefclub-account-deletion.service.js";
import {
  reefClubCookieNames,
  reefClubCookieOptions,
} from "./reefclub-cookies.js";

import {
  ReefClubAppleLinkDto,
  ReefClubDeleteMeDto,
  ReefClubGoogleLinkDto,
  ReefClubUpdateMeDto,
} from "./reefclub-auth.dto.js";
import {
  type ReefClubMe,
  ReefClubAuthService,
} from "./reefclub-auth.service.js";
import { REEFCLUB_SHARE_CONSENT_VERSION } from "./reefclub-consent.js";
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
 * DELETE /rc/v1/me deletes the account (slice 6).
 */
@Controller("rc/v1/me")
export class ReefClubMeController {
  constructor(
    private readonly auth: ReefClubAuthService,
    private readonly external: ReefClubExternalAuthService,
    private readonly limits: ReefClubRateLimits,
    private readonly deletion: ReefClubAccountDeletionService,
  ) {}

  /**
   * DELETE /rc/v1/me (plan v6.1, 3.2 and 4.5; slice 6): with a fresh sign-in,
   * the account is locked at once and deleted 30 days later. 202: accepted,
   * the deletion itself is later. The session cookies are cleared, the same
   * way as at logout. The limits are the login's: the password here is as
   * good to guess as there.
   */
  @Delete()
  @HttpCode(202)
  async remove(
    @Req() request: ReefClubRequest,
    @Body() body: ReefClubDeleteMeDto,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    const account = accountOf(request);
    this.limits.loginByAddress.check(reefClubCallerAddress(request));
    this.limits.loginByEmail.check(`delete:${account}`);
    await this.deletion.request(
      account,
      body.method === "PASSWORD"
        ? { method: "PASSWORD", password: body.password! }
        : body.method === "GOOGLE"
          ? { method: "GOOGLE", idToken: body.idToken! }
          : { method: "APPLE", idToken: body.idToken!, nonce: body.nonce! },
    );
    const names = reefClubCookieNames();
    response.cookie(
      names.session,
      "",
      reefClubCookieOptions(0, { httpOnly: true }),
    );
    response.cookie(
      names.csrf,
      "",
      reefClubCookieOptions(0, { httpOnly: false }),
    );
  }

  /**
   * The consent text version the share must carry (`reefclub-consent.ts`);
   * the web page shows the text of this version before sharing.
   */
  @Get("share-consent")
  shareConsent(): { version: string } {
    return { version: REEFCLUB_SHARE_CONSENT_VERSION };
  }

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
