import { environment } from "@/config/env";
import { authSessionStore } from "@/lib/auth/token-store";

import { needsJsonContentType } from "./json-content-type";
import { resolveRequestToken } from "./request-auth";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when `fetch` itself fails (no connectivity, DNS, TLS, timeout,
 * ...) — distinct from `ApiError`, which means the server was reached and
 * responded with a non-2xx status. Callers (see restore-session.ts,
 * sign-in.ts) rely on this distinction to avoid treating "the server is
 * temporarily unreachable" the same as "this token/credential is
 * invalid". */
export class ApiNetworkError extends Error {
  constructor(cause?: unknown) {
    super("A szerver jelenleg nem érhető el.");
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

/** Thrown when the app was launched without a usable server address. In
 * practice `src/app/_layout.tsx` shows the configuration problems instead
 * of the app, so this never reaches a screen — it exists so that a call
 * made anyway fails as a handled error rather than taking the process
 * down, which is the failure this whole path is here to prevent. */
export class ApiConfigError extends Error {
  constructor(readonly problems: string[]) {
    super("Az alkalmazás nincs beállítva: hiányzik vagy hibás a szerver címe.");
    this.name = "ApiConfigError";
  }
}

export interface ApiRequestOptions extends RequestInit {
  /** Skip attaching any Authorization header, even if a token is stored
   * locally. Used for the login request itself, so a stale or invalid
   * previously-stored token is never sent alongside new credentials. */
  skipAuth?: boolean;
  /** Explicit Bearer token to send instead of the one in SecureStore.
   * Used only to invalidate a just-issued session that failed to persist
   * locally, before it was ever saved (see sign-in.ts). */
  authToken?: string;
}

export async function apiRequest<T>(
  path: `/${string}`,
  init: ApiRequestOptions = {},
): Promise<T> {
  if (!environment.ok) {
    throw new ApiConfigError(environment.problems);
  }

  const { skipAuth, authToken, ...requestInit } = init;
  const storedToken = await authSessionStore.getToken();
  const token = resolveRequestToken({ skipAuth, authToken, storedToken });

  const headers = new Headers(requestInit.headers);
  headers.set("Accept", "application/json");

  if (needsJsonContentType(requestInit.body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${environment.config.apiUrl}${path}`, {
      ...requestInit,
      headers,
    });
  } catch (cause) {
    // Never let a raw fetch error (which may embed request details)
    // surface directly — normalize to a fixed, safe message.
    throw new ApiNetworkError(cause);
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (body.message) return body.message;
  } catch {
    // Fall through to a stable generic message when the server did not return JSON.
  }

  return `API request failed (${response.status}).`;
}
