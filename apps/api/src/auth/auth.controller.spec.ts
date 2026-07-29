import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthenticatedUser, Session } from "@acropora/types";

import { AuthController } from "./auth.controller.js";
import type { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import {
  CSRF_COOKIE_NAME,
  type CookieOptions,
  type CookieResponse,
  SESSION_COOKIE_NAME,
} from "./cookie.util.js";

const testUser: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.hu",
  displayName: "Teszt Owner",
  role: "OWNER",
};

function fakeSession(token: string): Session {
  return {
    id: "session-1",
    user: testUser,
    token,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function fakeCookieResponse(): CookieResponse & {
  cookies: Record<string, string>;
  cleared: string[];
} {
  const cookies: Record<string, string> = {};
  const cleared: string[] = [];
  return {
    cookies,
    cleared,
    cookie(name: string, value: string, _options: CookieOptions) {
      cookies[name] = value;
    },
    clearCookie(name: string, _options: { path: string }) {
      cleared.push(name);
    },
  };
}

describe("AuthController", () => {
  it("web login/password returns only { user } — the token never appears in the JSON body", async () => {
    const authService = {
      loginWithPassword: async () => fakeSession("web-token-abc"),
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const response = fakeCookieResponse();

    const body = await controller.loginWithPassword(
      { email: testUser.email, password: "secret" },
      response,
    );

    assert.deepEqual(Object.keys(body), ["user"]);
    assert.deepEqual(body.user, testUser);
    assert.equal(JSON.stringify(body).includes("web-token-abc"), false);
    // ...but the httpOnly session cookie and the separate CSRF cookie are
    // still set exactly as before.
    assert.equal(response.cookies[SESSION_COOKIE_NAME], "web-token-abc");
    assert.ok(response.cookies[CSRF_COOKIE_NAME]);
  });

  it("mobile login/password returns a Bearer token in the JSON body and sets no cookies at all", async () => {
    const authService = {
      loginWithPassword: async () => fakeSession("mobile-token-xyz"),
    } as unknown as AuthService;
    const controller = new AuthController(authService);

    const body = await controller.loginMobileWithPassword({
      email: testUser.email,
      password: "secret",
    });

    assert.equal(body.token, "mobile-token-xyz");
    assert.deepEqual(body.user, testUser);
    assert.ok(body.expiresAt);
  });

  it("logout invalidates a Bearer-authenticated session without touching any cookies", async () => {
    let loggedOutToken: string | undefined;
    const authService = {
      logout: async (token: string) => {
        loggedOutToken = token;
      },
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const response = fakeCookieResponse();
    const request = {
      headers: {},
      authToken: "bearer-token",
      authViaCookie: false,
    } as unknown as AuthenticatedRequest;

    const result = await controller.logout(request, response);

    assert.equal(loggedOutToken, "bearer-token");
    assert.deepEqual(response.cleared, []);
    assert.deepEqual(result, { success: true });
  });

  it("logout invalidates a cookie-authenticated session and clears both cookies", async () => {
    let loggedOutToken: string | undefined;
    const authService = {
      logout: async (token: string) => {
        loggedOutToken = token;
      },
    } as unknown as AuthService;
    const controller = new AuthController(authService);
    const response = fakeCookieResponse();
    const request = {
      headers: {},
      authToken: "cookie-token",
      authViaCookie: true,
    } as unknown as AuthenticatedRequest;

    await controller.logout(request, response);

    assert.equal(loggedOutToken, "cookie-token");
    assert.deepEqual(response.cleared.sort(), [CSRF_COOKIE_NAME, SESSION_COOKIE_NAME].sort());
  });
});
