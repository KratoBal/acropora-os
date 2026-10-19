import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
} from "@nestjs/common";

import { generateCsrfToken, parseCookies } from "../auth/cookie.util.js";
import type { CookieResponse } from "../auth/cookie.util.js";
import {
  ReefClubAppleSignInDto,
  ReefClubGoogleSignInDto,
  ReefClubLoginDto,
  ReefClubPasswordResetConfirmDto,
  ReefClubPasswordResetRequestDto,
  ReefClubRegisterDto,
  ReefClubTokenDto,
} from "./reefclub-auth.dto.js";
import {
  normalizeEmail,
  ReefClubAuthService,
  type ReefClubIssuedSession,
} from "./reefclub-auth.service.js";
import {
  reefClubCookieNames,
  reefClubCookieOptions,
} from "./reefclub-cookies.js";
import { ReefClubExternalAuthService } from "./reefclub-external-auth.service.js";
import {
  reefClubCallerAddress,
  ReefClubRateLimits,
} from "./reefclub-rate-limits.js";
import { ReefClubPublic, type ReefClubRequest } from "./reefclub.guard.js";

/** One answer for every bad link: unknown, used and expired look the same. */
const INVALID_LINK = "A link érvénytelen vagy lejárt.";

/**
 * POST /rc/v1/auth/* (plan v6.1, 3.2). Account deletion is slice 6.
 */
@Controller("rc/v1/auth")
export class ReefClubAuthController {
  constructor(
    private readonly auth: ReefClubAuthService,
    private readonly external: ReefClubExternalAuthService,
    private readonly limits: ReefClubRateLimits,
  ) {}

  /** Always 202, for a new address and an existing one alike (plan 3.2). */
  @ReefClubPublic()
  @Post("register")
  @HttpCode(202)
  register(@Body() body: ReefClubRegisterDto, @Req() request: ReefClubRequest) {
    this.limits.registerByAddress.check(reefClubCallerAddress(request));
    this.limits.registerByEmail.check(normalizeEmail(body.email));
    this.auth.register(body.email, body.password, body.consentVersion);
  }

  @ReefClubPublic()
  @Post("verify-email")
  @HttpCode(204)
  async verifyEmail(
    @Body() body: ReefClubTokenDto,
    @Req() request: ReefClubRequest,
  ): Promise<void> {
    this.limits.tokenByAddress.check(reefClubCallerAddress(request));
    if (!(await this.auth.verifyEmail(body.token)))
      throw new BadRequestException(INVALID_LINK);
  }

  @ReefClubPublic()
  @Post("login")
  @HttpCode(204)
  async login(
    @Body() body: ReefClubLoginDto,
    @Req() request: ReefClubRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    this.limits.loginByAddress.check(reefClubCallerAddress(request));
    this.limits.loginByEmail.check(normalizeEmail(body.email));
    setSessionCookies(
      response,
      await this.auth.login(body.email, body.password),
    );
  }

  /**
   * Google sign-in (plan 3.2, slice 3): signs in to the account the Google
   * account is bound to, or creates one; no merging by e-mail
   * (`ReefClubExternalAuthService`).
   */
  @ReefClubPublic()
  @Post("google")
  @HttpCode(204)
  async google(
    @Body() body: ReefClubGoogleSignInDto,
    @Req() request: ReefClubRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    this.limits.externalByAddress.check(reefClubCallerAddress(request));
    setSessionCookies(
      response,
      await this.external.signIn("GOOGLE", body.idToken, {
        consentVersion: body.consentVersion,
      }),
    );
  }

  /** Apple sign-in: the same, with the nonce checked. */
  @ReefClubPublic()
  @Post("apple")
  @HttpCode(204)
  async apple(
    @Body() body: ReefClubAppleSignInDto,
    @Req() request: ReefClubRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    this.limits.externalByAddress.check(reefClubCallerAddress(request));
    setSessionCookies(
      response,
      await this.external.signIn("APPLE", body.idToken, {
        nonce: body.nonce,
        consentVersion: body.consentVersion,
      }),
    );
  }

  /** Always 202 (plan 3.2). */
  @ReefClubPublic()
  @Post("password-reset")
  @HttpCode(202)
  requestPasswordReset(
    @Body() body: ReefClubPasswordResetRequestDto,
    @Req() request: ReefClubRequest,
  ) {
    this.limits.resetByAddress.check(reefClubCallerAddress(request));
    this.limits.resetByEmail.check(normalizeEmail(body.email));
    this.auth.requestPasswordReset(body.email);
  }

  /** Sets the new password and ends every session of the account. */
  @ReefClubPublic()
  @Post("password-reset/confirm")
  @HttpCode(204)
  async confirmPasswordReset(
    @Body() body: ReefClubPasswordResetConfirmDto,
    @Req() request: ReefClubRequest,
  ): Promise<void> {
    this.limits.tokenByAddress.check(reefClubCallerAddress(request));
    if (!(await this.auth.confirmPasswordReset(body.token, body.password)))
      throw new BadRequestException(INVALID_LINK);
  }

  /**
   * Public and idempotent: it ends the session named by the cookie, if any,
   * and clears the cookies either way. No body is accepted.
   */
  @ReefClubPublic()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() request: ReefClubRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<void> {
    const names = reefClubCookieNames();
    const cookie = request.headers.cookie;
    const token = parseCookies(Array.isArray(cookie) ? cookie[0] : cookie)[
      names.session
    ];
    await this.auth.logout(token);
    // Overwritten with the same attributes rather than `clearCookie`: the
    // browser refuses a `__Host-` cookie, the expiring one included, without
    // `Secure` and `Path=/`.
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
}

/** The session cookie and its CSRF pair, for the session's remaining life. */
function setSessionCookies(
  response: CookieResponse,
  session: ReefClubIssuedSession,
): void {
  const names = reefClubCookieNames();
  const maxAgeMs = Math.max(0, session.expiresAt.getTime() - Date.now());
  response.cookie(
    names.session,
    session.token,
    reefClubCookieOptions(maxAgeMs, { httpOnly: true }),
  );
  response.cookie(
    names.csrf,
    generateCsrfToken(),
    reefClubCookieOptions(maxAgeMs, { httpOnly: false }),
  );
}
