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
};

function createContext(request: {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
}): ExecutionContext {
  return {
    getHandler: () => createContext,
    getClass: () => AuthGuard,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(isPublic: boolean | undefined): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

function fakeAuthService(): AuthService {
  return {
    resolveToken: async (token: string) => {
      if (token !== "valid-token") {
        throw new UnauthorizedException("Érvénytelen vagy lejárt munkamenet.");
      }
      return testUser;
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
});
