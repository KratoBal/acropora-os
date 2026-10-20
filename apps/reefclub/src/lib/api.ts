/**
 * THE REEFCLUB API CLIENT. The browser calls `/rc/v1/*` on its own host; the
 * app forwards that prefix to the ReefClub container (next.config.ts), so the
 * session cookie and the CSRF cookie belong to this host.
 *
 * CSRF: the server uses a double submit. The CSRF cookie is readable by the
 * page and is mirrored into `x-csrf-token` on every request that is not a
 * GET/HEAD (apps/api/src/reefclub/reefclub-cookies.ts, reefclub.guard.ts). In
 * production both cookies carry the `__Host-` prefix, in development they do
 * not; `NODE_ENV` is inlined at build time, as it is on the server.
 */
export const CSRF_HEADER = "x-csrf-token";

export function csrfCookieName(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  return nodeEnv === "production" ? "__Host-rc_csrf" : "rc_csrf";
}

export function readCookie(name: string, cookies: string): string | null {
  for (const part of cookies.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export class ReefClubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReefClubApiError";
  }
}

const UNREACHABLE = "A szolgáltatás most nem érhető el. Próbáld újra később.";

/** The server's own words when it has them (Nest: `message` is a string or a list). */
export function errorMessageOf(status: number, body: unknown): string {
  const message =
    body && typeof body === "object"
      ? (body as { message?: unknown }).message
      : undefined;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message)) {
    const lines = message.filter(
      (line): line is string => typeof line === "string" && line.trim() !== "",
    );
    if (lines.length) return lines.join("\n");
  }
  if (status === 429) return "Túl sok próbálkozás. Próbáld újra később.";
  if (status === 401) return "A munkamenet lejárt. Lépj be újra.";
  if (status === 403)
    return "A kérést nem lehetett ellenőrizni. Frissítsd az oldalt.";
  if (status === 404) return "Nem található.";
  return UNREACHABLE;
}

export interface RequestOptions {
  body?: unknown;
  fetchImpl?: typeof fetch;
  cookies?: string;
}

/** One call. Resolves with the parsed JSON, or `undefined` for an empty answer (204, 202). */
export async function rc<T = undefined>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  { body, fetchImpl, cookies }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") {
    const token = readCookie(
      csrfCookieName(),
      cookies ?? (typeof document === "undefined" ? "" : document.cookie),
    );
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(`/rc/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ReefClubApiError(0, UNREACHABLE);
  }

  const text = await response.text().catch(() => "");
  let parsed: unknown;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!response.ok) {
    throw new ReefClubApiError(
      response.status,
      errorMessageOf(response.status, parsed),
    );
  }
  return parsed as T;
}
