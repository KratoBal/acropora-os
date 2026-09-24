import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedUser } from "@acropora/types";

import type { AuthService } from "../auth.service.js";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "../cookie.util.js";
import { AuthGuard } from "./auth.guard.js";

const testUser: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.local",
  displayName: "Teszt Felhasználó",
  role: "OWNER",
  customerId: null,
  supplierId: null,
};

/**
 * A HAMIS VALASZ (Response) OBJEKTUM -- CSAK azert kell, mert a csuszo
 * lejarat a suti maxAge-et is ujra beallitja (`AuthGuard`, Balazs kerese,
 * 2026-09-24 08:15). Felveszi, MILYEN nevvel/ertekkel hivtak meg a
 * `cookie()`-t, hogy az allitas ne csak azt merje, hogy a guard nem
 * dobott hibat, hanem a TENYLEGES sutit is.
 */
function fakeResponse(): {
  cookie(name: string, value: string, options: { maxAge: number }): void;
  calls: Array<{ name: string; value: string; maxAge: number }>;
} {
  const calls: Array<{ name: string; value: string; maxAge: number }> = [];
  return {
    calls,
    cookie(name, value, options) {
      calls.push({ name, value, maxAge: options.maxAge });
    },
  };
}

function createContext(
  request: {
    headers: Record<string, string | string[] | undefined>;
    method?: string;
  },
  response: ReturnType<typeof fakeResponse> = fakeResponse(),
): ExecutionContext {
  return {
    getHandler: () => createContext,
    getClass: () => AuthGuard,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(isPublic: boolean | undefined): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

/**
 * `extended` VEZERELHETO, HOGY A CSUSZO-SUTI VISELKEDES KULON TESZTELHETO
 * LEGYEN a hitelesitesi dontestol -- Balazs kerese (2026-09-24 08:15). A
 * VALODI hosszabbitasi/debounce mechanikat a
 * `session.repository.integration.spec.ts` fedi, a VALODI adatbazis ellen;
 * ez a fake csak azt allitja, MIT csinal a guard, ha `resolveToken` MAR
 * eldontotte, hogy hosszabbitott-e.
 */
function fakeAuthService(extended = false): AuthService {
  return {
    resolveToken: async (token: string) => {
      if (token !== "valid-token") {
        throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
      }
      return {
        user: testUser,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        extended,
      };
    },
  } as unknown as AuthService;
}

describe("AuthGuard", () => {
  it("allows public routes without any credential", async () => {
    const guard = new AuthGuard(reflectorReturning(true), fakeAuthService());
    const request: { headers: Record<string, string> } = { headers: {} };
    assert.equal(await guard.canActivate(createContext(request)), true);
  });

  it("rejects a request with neither a Bearer header nor a session cookie", async () => {
    const guard = new AuthGuard(reflectorReturning(false), fakeAuthService());
    await assert.rejects(
      guard.canActivate(createContext({ headers: {} })),
      UnauthorizedException,
    );
  });

  it("authenticates via the Bearer header exactly as before, unaffected by cookies", async () => {
    const guard = new AuthGuard(reflectorReturning(false), fakeAuthService());
    const request = {
      headers: { authorization: "Bearer valid-token" },
      method: "POST",
    };
    const typedRequest = request as unknown as {
      headers: Record<string, string>;
      method: string;
      user?: AuthenticatedUser;
      authToken?: string;
      authViaCookie?: boolean;
    };
    assert.equal(await guard.canActivate(createContext(typedRequest)), true);
    assert.deepEqual(typedRequest.user, testUser);
    assert.equal(typedRequest.authToken, "valid-token");
    assert.equal(typedRequest.authViaCookie, undefined);
  });

  it("authenticates a GET request via the session cookie without requiring CSRF", async () => {
    const guard = new AuthGuard(reflectorReturning(false), fakeAuthService());
    const request = {
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid-token` },
      method: "GET",
    };
    const typedRequest = request as unknown as {
      headers: Record<string, string>;
      method: string;
      user?: AuthenticatedUser;
      authViaCookie?: boolean;
    };
    assert.equal(await guard.canActivate(createContext(typedRequest)), true);
    assert.deepEqual(typedRequest.user, testUser);
    assert.equal(typedRequest.authViaCookie, true);
  });

  it("rejects a mutating cookie-authenticated request with no CSRF header", async () => {
    const guard = new AuthGuard(reflectorReturning(false), fakeAuthService());
    const request = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-token; ${CSRF_COOKIE_NAME}=csrf-abc`,
      },
      method: "POST",
    };
    await assert.rejects(
      guard.canActivate(createContext(request)),
      ForbiddenException,
    );
  });

  it("rejects a mutating cookie-authenticated request when the CSRF header does not match the cookie", async () => {
    const guard = new AuthGuard(reflectorReturning(false), fakeAuthService());
    const request = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-token; ${CSRF_COOKIE_NAME}=csrf-abc`,
        "x-csrf-token": "csrf-does-not-match",
      },
      method: "POST",
    };
    await assert.rejects(
      guard.canActivate(createContext(request)),
      ForbiddenException,
    );
  });

  it("accepts a mutating cookie-authenticated request when the CSRF header matches the cookie", async () => {
    const guard = new AuthGuard(reflectorReturning(false), fakeAuthService());
    const request = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-token; ${CSRF_COOKIE_NAME}=csrf-abc`,
        "x-csrf-token": "csrf-abc",
      },
      method: "POST",
    };
    const typedRequest = request as unknown as {
      headers: Record<string, string>;
      method: string;
      user?: AuthenticatedUser;
      authViaCookie?: boolean;
    };
    assert.equal(await guard.canActivate(createContext(typedRequest)), true);
    assert.deepEqual(typedRequest.user, testUser);
    assert.equal(typedRequest.authViaCookie, true);
  });

  /**
   * A SUTI MAXAGE-E IS CSUSZIK -- Balazs 2. pontja (2026-09-24 08:15):
   * kulonben a bongeszo a sajat, be nem allitott orajaval dobja el a
   * sutit, akarhogy is hosszabbitottuk a szerver oldali sessiont.
   */
  it("extended=false: leaves the cookies untouched (no wasted Set-Cookie)", async () => {
    const guard = new AuthGuard(
      reflectorReturning(false),
      fakeAuthService(false),
    );
    const response = fakeResponse();
    const request = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-token; ${CSRF_COOKIE_NAME}=csrf-abc`,
      },
      method: "GET",
    };
    assert.equal(
      await guard.canActivate(createContext(request, response)),
      true,
    );
    assert.deepEqual(response.calls, []);
  });

  it("extended=true: refreshes BOTH cookies, keeping the SAME csrf value and a new maxAge", async () => {
    const guard = new AuthGuard(
      reflectorReturning(false),
      fakeAuthService(true),
    );
    const response = fakeResponse();
    const request = {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=valid-token; ${CSRF_COOKIE_NAME}=csrf-abc`,
      },
      method: "GET",
    };
    assert.equal(
      await guard.canActivate(createContext(request, response)),
      true,
    );
    assert.equal(response.calls.length, 2);
    const sessionCall = response.calls.find(
      (c) => c.name === SESSION_COOKIE_NAME,
    );
    const csrfCall = response.calls.find((c) => c.name === CSRF_COOKIE_NAME);
    assert.ok(sessionCall);
    assert.equal(sessionCall!.value, "valid-token");
    assert.ok(csrfCall);
    // A CSRF ERTEK NEM VALTOZIK -- ha itt ujat generalnank, a kliens
    // KOVETKEZO allapotvaltoztato kerese elbukna a CSRF-ellenorzesen,
    // mert a nala levo (regi) ertek mar nem egyezne a sutiben allo ujjal.
    assert.equal(csrfCall!.value, "csrf-abc");
    // Mindket maxAge kb. a fakeAuthService altal adott 60s korul all.
    assert.ok(sessionCall!.maxAge > 0 && sessionCall!.maxAge <= 60_000);
    assert.ok(csrfCall!.maxAge > 0 && csrfCall!.maxAge <= 60_000);
  });

  it("extended=true but no csrf cookie present: does not crash and does not set cookies", async () => {
    const guard = new AuthGuard(
      reflectorReturning(false),
      fakeAuthService(true),
    );
    const response = fakeResponse();
    const request = {
      headers: { cookie: `${SESSION_COOKIE_NAME}=valid-token` },
      method: "GET",
    };
    assert.equal(
      await guard.canActivate(createContext(request, response)),
      true,
    );
    assert.deepEqual(response.calls, []);
  });

  it("Bearer-authenticated (mobile) requests never touch the response cookies, extended or not", async () => {
    const guard = new AuthGuard(
      reflectorReturning(false),
      fakeAuthService(true),
    );
    const response = fakeResponse();
    const request = {
      headers: { authorization: "Bearer valid-token" },
      method: "POST",
    };
    assert.equal(
      await guard.canActivate(createContext(request, response)),
      true,
    );
    assert.deepEqual(response.calls, []);
  });
});
