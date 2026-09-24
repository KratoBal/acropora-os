import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequest } from "../auth.types.js";
import { AuthService } from "../auth.service.js";
import {
  cookieOptions,
  type CookieResponse,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  parseCookies,
  SESSION_COOKIE_NAME,
} from "../cookie.util.js";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator.js";

// CSRF only matters for requests that change state; GET/HEAD/OPTIONS are
// expected to be side-effect-free and are exempt, matching the standard
// double-submit-cookie convention.
const CSRF_EXEMPT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const [scheme, bearerToken] = authorization?.split(" ") ?? [];

    if (scheme === "Bearer" && bearerToken) {
      const resolved = await this.authService.resolveToken(bearerToken);
      request.user = resolved.user;
      request.authToken = bearerToken;
      return true;
    }

    // No Bearer header — fall back to the httpOnly session cookie used by
    // the production (password-based) login. A Bearer token, unlike a
    // cookie, is never sent automatically by the browser, so it can't be
    // exploited by cross-site requests the way an ambient cookie can —
    // that's why only this path needs the CSRF check below.
    const cookies = parseCookies(request.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE_NAME];

    if (!cookieToken) {
      throw new UnauthorizedException("Bejelentkezés szükséges.");
    }

    const csrfCookie = cookies[CSRF_COOKIE_NAME];
    const method = request.method?.toUpperCase();
    if (!method || !CSRF_EXEMPT_METHODS.has(method)) {
      const csrfHeader = firstHeaderValue(
        request.headers[CSRF_HEADER_NAME] as string | string[] | undefined,
      );
      if (!csrfCookie || !csrfHeader || csrfHeader !== csrfCookie) {
        throw new ForbiddenException("CSRF-ellenőrzés sikertelen.");
      }
    }

    const resolved = await this.authService.resolveToken(cookieToken);
    request.user = resolved.user;
    request.authToken = cookieToken;
    request.authViaCookie = true;

    /**
     * A SUTI MAXAGE-E IS CSUSZIK -- Balazs 2. pontja (2026-09-24 08:15):
     * kulonben a bongeszo a SAJAT, be nem allitott orajaval dobja el a
     * sutit, akarhogy is hosszabbitottuk a szerver oldali sessiont. CSAK
     * akkor allitjuk ujra, ha `resolveToken` TENYLEG hosszabbitott
     * (`resolved.extended`) -- kulonben minden egyes keres felesleges
     * `Set-Cookie` fejlecet kapna.
     */
    if (resolved.extended && csrfCookie) {
      const response = context.switchToHttp().getResponse<CookieResponse>();
      const maxAgeMs = Math.max(
        0,
        new Date(resolved.expiresAt).getTime() - Date.now(),
      );
      // UGYANAZ a session-token ES ugyanaz a CSRF-ertek megy vissza, csak a
      // maxAge no -- a CSRF erteket itt SOSEM generaljuk ujra: a kliens a
      // bejelentkezeskor kapott erteket kuldi vissza a fejlecben, es ha ez
      // itt masikra valtana, minden kovetkezo allapotvaltoztato keres CSRF-
      // ellenorzese elbukna.
      response.cookie(
        SESSION_COOKIE_NAME,
        cookieToken,
        cookieOptions(maxAgeMs, { httpOnly: true }),
      );
      response.cookie(
        CSRF_COOKIE_NAME,
        csrfCookie,
        cookieOptions(maxAgeMs, { httpOnly: false }),
      );
    }

    return true;
  }
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
