/**
 * THE CROSS-SITE CHECK ON EVERY STATE-CHANGING REQUEST, THE PUBLIC ONES TOO
 * (barracuda, #1717 review, point A).
 *
 * The CSRF double submit protects only the routes behind a session. Login,
 * register and the rest are public, and CORS stops a foreign page from READING
 * the answer, not from SENDING the request: a plain HTML form posting to
 * `/rc/v1/auth/login` with the attacker's own credentials would log the
 * visitor into the attacker's account, because `SameSite=Lax` lets a top-level
 * navigation set the cookie. From the next slices on the visitor would then
 * record measurements into an account the attacker reads.
 *
 * So every method other than GET, HEAD and OPTIONS must come from the ReefClub
 * web origin:
 *   - an `Origin` header must equal the origin of `REEFCLUB_WEB_URL` (a browser
 *     sends it on every cross-origin POST, and `null` from a sandboxed or file
 *     page is refused like any foreign value);
 *   - without `Origin`, a `Sec-Fetch-Site` header must say `same-origin` or
 *     `none` (a user-typed navigation); `same-site` is refused, because a
 *     sibling subdomain of the shop is same-site and must not be trusted;
 *   - with neither header the request is not a browser's, so it carries no
 *     ambient cookie of a victim, and it passes. A request with a session still
 *     needs the double submit on top.
 *
 * And the body must be JSON: a form encoding (`application/x-www-form-urlencoded`,
 * `multipart/form-data`, `text/plain`) is exactly what an HTML form can send
 * without a CORS preflight, so refusing it closes the same door from a second
 * side. A request without a body (logout) has no type to check.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRUSTED_FETCH_SITES = new Set(["same-origin", "none"]);

export type CrossSiteRefusal =
  { kind: "origin"; reason: string } | { kind: "media-type"; reason: string };

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim();
}

function hasBody(headers: Record<string, string | string[] | undefined>) {
  const length = header(headers, "content-length");
  return (
    header(headers, "transfer-encoding") !== undefined ||
    (length !== undefined && length !== "0")
  );
}

/** Why this request is refused as cross-site or non-JSON, or null if it may go on. */
export function crossSiteRefusal(
  request: {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
  },
  webOrigin: string,
): CrossSiteRefusal | null {
  const method = request.method?.toUpperCase() ?? "";
  if (SAFE_METHODS.has(method)) return null;

  const origin = header(request.headers, "origin");
  if (origin !== undefined) {
    if (origin !== webOrigin)
      return { kind: "origin", reason: "idegen Origin" };
  } else {
    const site = header(request.headers, "sec-fetch-site");
    if (site !== undefined && !TRUSTED_FETCH_SITES.has(site.toLowerCase()))
      return { kind: "origin", reason: "idegen Sec-Fetch-Site" };
  }

  if (hasBody(request.headers)) {
    const type = header(request.headers, "content-type")?.toLowerCase() ?? "";
    if (!/^application\/json(\s*;|$)/.test(type))
      return { kind: "media-type", reason: "csak JSON törzs" };
  }
  return null;
}

/** The origin (scheme, host, port) of the ReefClub web address. */
export function webOriginOf(webUrl: string): string {
  return new URL(webUrl).origin;
}
