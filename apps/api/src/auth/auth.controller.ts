import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { AuthenticatedUser, Session } from "@acropora/types";

import { AuthService } from "./auth.service.js";
import type {
  AuthenticatedRequest,
  DevelopmentLoginDto,
} from "./auth.types.js";
import { ProductionLoginDto } from "./auth.types.js";
import {
  cookieOptions,
  type CookieResponse,
  CSRF_COOKIE_NAME,
  generateCsrfToken,
  SESSION_COOKIE_NAME,
} from "./cookie.util.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import { Public } from "./decorators/public.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("me")
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Public()
  @Post("login")
  login(@Body() body: DevelopmentLoginDto): Promise<Session> {
    return this.authService.loginWithDevelopmentUser(body.email ?? "");
  }

  /**
   * The real production login: verifies the password, then delivers the
   * session exclusively through an httpOnly cookie (never in the response
   * body) plus a separate, JS-readable CSRF cookie the frontend must echo
   * back as `X-CSRF-Token` on state-changing requests. See
   * docs/AUTHENTICATION.md for the full flow.
   */
  @Public()
  @Post("login/password")
  async loginWithPassword(
    @Body() body: ProductionLoginDto,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ user: AuthenticatedUser }> {
    const session = await this.authService.loginWithPassword(
      body.email,
      body.password,
    );
    this.setSessionCookies(response, session);
    return { user: session.user };
  }

  /**
   * Mobile counterpart to `login/password`: same credential check and
   * `AuthService.loginWithPassword` call, but there is no browser cookie
   * jar shared with the API, so the token is returned directly in the JSON
   * body instead of an httpOnly cookie. Deliberately does not set — or
   * clear — any cookies (no session cookie, no CSRF cookie): a mobile
   * client authenticates every request with the returned `token` as a
   * `Authorization: Bearer` header (see AuthGuard), which the CSRF
   * double-submit check in AuthGuard does not apply to in the first place.
   */
  @Public()
  @Post("mobile/login/password")
  async loginMobileWithPassword(
    @Body() body: ProductionLoginDto,
  ): Promise<{ token: string; expiresAt: string; user: AuthenticatedUser }> {
    const session = await this.authService.loginWithPassword(
      body.email,
      body.password,
    );
    return {
      token: session.token ?? "",
      expiresAt: session.expiresAt,
      user: session.user,
    };
  }

  @Post("logout")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    if (request.authToken) await this.authService.logout(request.authToken);
    if (request.authViaCookie) {
      response.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      response.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
    }
    return { success: true };
  }

  private setSessionCookies(response: CookieResponse, session: Session): void {
    const maxAgeMs = Math.max(
      0,
      new Date(session.expiresAt).getTime() - Date.now(),
    );
    response.cookie(
      SESSION_COOKIE_NAME,
      session.token ?? "",
      cookieOptions(maxAgeMs, { httpOnly: true }),
    );
    response.cookie(
      CSRF_COOKIE_NAME,
      generateCsrfToken(),
      cookieOptions(maxAgeMs, { httpOnly: false }),
    );
  }
}
