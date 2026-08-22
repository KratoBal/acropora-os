const CSRF_COOKIE_NAME = "acropora_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Reads the CSRF cookie the production (password-based) login sets. Only
 * ever present when using cookie-based session auth — the development
 * login never sets it, so this is a harmless no-op in development.
 */
function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Builds the authentication headers shared by fetch- and XHR-based API
 * calls. Production relies on the session cookie and mirrors the readable
 * CSRF cookie on mutating requests; development uses a Bearer token.
 */
export function apiAuthHeaders(
  token: string,
  method = "GET",
): Record<string, string> {
  const csrfToken = SAFE_METHODS.has(method.toUpperCase())
    ? undefined
    : readCsrfCookie();

  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
  };
}

/**
 * A JSON body needs the header to go with it. Without it `fetch` labels a
 * string body `text/plain`, the API's JSON parser leaves it alone, and the
 * request arrives with an empty body — so every field fails validation at
 * once, exactly as if the form had been submitted blank. The header belongs
 * here rather than in each caller: leaving it out is a silent mistake that
 * only surfaces on screen, in front of whoever was filling the form.
 *
 * A non-string body is left alone. `FormData` (the asset document upload)
 * carries a boundary the browser writes itself, and a hand-written header
 * would break that upload.
 */
function jsonContentType(
  body: BodyInit | null | undefined,
): Record<string, string> {
  return typeof body === "string" ? { "Content-Type": "application/json" } : {};
}

export async function apiRequest<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    const method = (init?.method ?? "GET").toUpperCase();
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...jsonContentType(init?.body),
        // With a production (cookie-based) session there is no
        // client-readable token — the browser sends the httpOnly session
        // cookie automatically instead. Only attach a Bearer header when
        // there's an actual token (the development login path); sending
        // `Authorization: Bearer ` with an empty value would otherwise
        // make the API guard reject the request before it ever falls
        // back to checking the cookie.
        ...apiAuthHeaders(token, method),
        ...init?.headers,
      },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw cause;
    throw new ApiError("A szerver nem érhető el. Ellenőrizd a kapcsolatot.", 0);
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError("A munkamenet lejárt. Jelentkezz be újra.", 401);
    }
    if (response.status === 403) {
      throw new ApiError("Nincs jogosultságod ehhez a művelethez.", 403);
    }
    let serverMessage: string | undefined;
    try {
      const payload = (await response.json()) as {
        message?: string | string[];
      };
      // One line per complaint. Joined with a space, a failed form comes back
      // as a single run-on sentence: three validator messages behind the
      // first one, with nothing to say where one ends and the next begins.
      serverMessage = Array.isArray(payload.message)
        ? payload.message.join("\n")
        : payload.message;
    } catch {
      serverMessage = undefined;
    }
    const fallback: Record<number, string> = {
      400: "A megadott adatok nem érvényesek.",
      404: "A kért import batch nem található.",
      409: "Az adat időközben megváltozott. Frissítsd a listát.",
      422: "A művelet üzleti feltételei nem teljesülnek.",
    };
    throw new ApiError(
      serverMessage ??
        fallback[response.status] ??
        "A kérés feldolgozása nem sikerült.",
      response.status,
    );
  }

  return (await response.json()) as T;
}
