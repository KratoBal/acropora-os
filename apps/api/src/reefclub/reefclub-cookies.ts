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
 *
 * A CONDITION THIS PUTS ON THE WEB APP (barracuda, #1717 review, point C): a
 * `__Host-` cookie is readable only on the host that set it. The double submit
 * therefore works only if the ReefClub web page (`REEFCLUB_WEB_URL`) is served
 * from the SAME host as these `/rc/v1` answers, i.e. the web app proxies
 * `/rc/v1` to this process (the way the internal web proxies its API). If the
 * web app ever runs on another host, `document.cookie` will not see the CSRF
 * cookie and every PATCH will be a 403: then the login answer must also carry
 * the CSRF token in its body. Slice 9 decides; this is where the condition is.
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
