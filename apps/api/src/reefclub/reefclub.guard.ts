import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { parseCookies } from "../auth/cookie.util.js";
import {
  REEFCLUB_CSRF_HEADER,
  reefClubCookieNames,
} from "./reefclub-cookies.js";
import { ReefClubSessionRepository } from "./reefclub-session.repository.js";

/**
 * Marks a ReefClub route as reachable without a session. A separate key from
 * the internal `@Public()`: neither side's marker means anything to the other
 * side's guard.
 */
export const REEFCLUB_PUBLIC_KEY = "reefclub:is-public";
export const ReefClubPublic = () => SetMetadata(REEFCLUB_PUBLIC_KEY, true);

export interface ReefClubRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  reefClubAccountId?: string;
  reefClubToken?: string;
}

const CSRF_EXEMPT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * THE ONLY GUARD OF THE REEFCLUB PROCESS (plan v6.1, 4.1), registered as the
 * application guard in `ReefClubAppModule`, so a new route is closed unless it
 * says `@ReefClubPublic()`.
 *
 * It accepts exactly one credential: the ReefClub session cookie, resolved
 * against the ReefClub session table. No `Authorization` header is read, and
 * the internal session cookie is not read. So an internal token is refused
 * here whichever way it arrives (as a Bearer header, as the internal cookie,
 * or pasted into the ReefClub cookie, where it matches no row), and the
 * internal `AuthGuard` likewise never looks at the ReefClub cookie. The
 * integration spec `reefclub-ket-vilag.integration.spec.ts` measures all of
 * these against the routes the loaded applications actually serve.
 */
@Injectable()
export class ReefClubGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: ReefClubSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      REEFCLUB_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ReefClubRequest>();
    const names = reefClubCookieNames();
    const cookies = parseCookies(firstValue(request.headers.cookie));
    const token = cookies[names.session];
    if (!token) throw new UnauthorizedException("Bejelentkezés szükséges.");

    // The session first, the CSRF check second: a token that is not a
    // ReefClub session is a 401 on every route and every method, so a foreign
    // credential gets one answer however the request is shaped.
    const session = await this.sessions.findActive(token);
    if (!session)
      throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");

    const method = request.method?.toUpperCase();
    if (!method || !CSRF_EXEMPT_METHODS.has(method)) {
      const header = firstValue(request.headers[REEFCLUB_CSRF_HEADER]);
      const cookie = cookies[names.csrf];
      if (!cookie || !header || header !== cookie)
        throw new ForbiddenException("CSRF-ellenőrzés sikertelen.");
    }

    request.reefClubAccountId = session.accountId;
    request.reefClubToken = token;
    return true;
  }
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
