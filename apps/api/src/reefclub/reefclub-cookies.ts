import type { CookieOptions } from "../auth/cookie.util.js";

/**
 * THE REEFCLUB COOKIES, NAMED APART FROM THE INTERNAL ONES (plan v6.1, 3.1).
 *
 * In production the names carry the `__Host-` prefix. The browser then accepts
 * the cookie only with `Secure`, `Path=/` and NO `Domain` attribute, so it is
 * bound to the ReefClub host and cannot be set or read by a sibling subdomain
 * of the shop. That is the plan's "only for the ReefClub host", enforced by the
 * browser rather than by our own discipline. Outside production the plain
 * names are used, because a `__Host-` cookie is refused over plain HTTP.
 *
 * The CSRF cookie is the same double-submit pattern as the internal one
 * (`auth/cookie.util.ts`): readable by the page, mirrored into a header on
 * every state-changing request.
 */
export interface ReefClubCookieNames {
  session: string;
  csrf: string;
}

export const REEFCLUB_CSRF_HEADER = "x-csrf-token";

export function reefClubCookieNames(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): ReefClubCookieNames {
  return nodeEnv === "production"
    ? { session: "__Host-rc_session", csrf: "__Host-rc_csrf" }
    : { session: "rc_session", csrf: "rc_csrf" };
}

export function reefClubCookieOptions(
  maxAgeMs: number,
  { httpOnly }: { httpOnly: boolean },
  nodeEnv: string | undefined = process.env.NODE_ENV,
): CookieOptions {
  return {
    httpOnly,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}
