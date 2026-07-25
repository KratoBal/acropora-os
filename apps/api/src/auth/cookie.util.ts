import { randomBytes } from "node:crypto";

/**
 * No `cookie-parser` dependency: the repo's established convention is to
 * avoid adding a package for something this small (see the comment in
 * `users/password.util.ts` re: scrypt instead of bcrypt/argon2). Incoming
 * cookies only ever need to be read here, in the auth guard, so a tiny
 * parser is enough.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    const rawValue = part.slice(separatorIndex + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export const SESSION_COOKIE_NAME = "acropora_session";
export const CSRF_COOKIE_NAME = "acropora_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Shared `Set-Cookie` attributes for both the session and CSRF cookies.
 * `secure` is gated on NODE_ENV rather than hardcoded so this keeps working
 * in any non-production environment that legitimately runs over plain
 * HTTP; the production login endpoint itself is unreachable outside
 * NODE_ENV=production (see AuthService.loginWithPassword), so this does
 * not weaken production behavior.
 *
 * The session cookie is httpOnly (never readable by JS — that's the whole
 * point of moving off the old Bearer-token-in-localStorage pattern the
 * docs flagged as an XSS risk). The CSRF cookie is deliberately NOT
 * httpOnly: the frontend has to read its value to mirror it into the
 * `X-CSRF-Token` header on state-changing requests (the standard
 * "double-submit cookie" pattern) — a cross-site attacker can trigger the
 * request but, thanks to the same-origin policy, cannot read this cookie
 * to forge a matching header.
 */
export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function cookieOptions(
  maxAgeMs: number,
  { httpOnly }: { httpOnly: boolean },
): CookieOptions {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

/**
 * Minimal structural type for the two Express `Response` methods the auth
 * controller needs. Deliberately not importing Express's own `Response`
 * type here: `express` is only a *transitive* dependency (pulled in by
 * `@nestjs/platform-express`), so it isn't resolvable from this package's
 * own node_modules under pnpm's strict linking — and adding `@types/express`
 * as a direct devDependency just for two method signatures isn't worth it
 * when NestJS's `@Res()` decorator injects the real Express response
 * object regardless of how it's typed here.
 */
export interface CookieResponse {
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: { path: string }): void;
}
