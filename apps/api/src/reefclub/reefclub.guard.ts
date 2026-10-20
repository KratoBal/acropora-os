import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { parseCookies } from "../auth/cookie.util.js";
import {
  REEFCLUB_CSRF_HEADER,
  reefClubCookieNames,
} from "./reefclub-cookies.js";
import { reefClubWebUrl } from "./reefclub-mail.js";
import { crossSiteRefusal, webOriginOf } from "./reefclub-origin.js";
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
 *
 * BEFORE ANY OF THAT, on every route, public or not: a state-changing request
 * from a foreign origin, or with a non-JSON body, is refused
 * (`reefclub-origin.ts`, barracuda #1717 A). That is what keeps a foreign
 * page from logging the visitor into someone else's account.
 */
@Injectable()
export class ReefClubGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: ReefClubSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ReefClubRequest>();
    const refusal = crossSiteRefusal(request, webOriginOf(reefClubWebUrl()));
    if (refusal?.kind === "origin")
      throw new ForbiddenException("Idegen oldalról érkezett kérés.");
    if (refusal?.kind === "media-type")
      throw new UnsupportedMediaTypeException("Csak JSON törzs fogadható.");

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      REEFCLUB_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

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

/**
 * The account the guard put on the request. The guard sets it on every
 * non-public route; a missing one is a wiring fault, and it must not fall
 * through to some default account.
 */
export function reefClubAccountOf(request: ReefClubRequest): string {
  if (!request.reefClubAccountId)
    throw new Error("ReefClub route reached without a ReefClub session.");
  return request.reefClubAccountId;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
