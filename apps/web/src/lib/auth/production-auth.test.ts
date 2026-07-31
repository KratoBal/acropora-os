import type { AuthenticatedUser } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductionAuthAdapter } from "./production-auth";

const owner: AuthenticatedUser = {
  id: "owner-id",
  email: "owner@acropora.hu",
  displayName: "Tulajdonos",
  role: "OWNER",
};

const originalFetch = globalThis.fetch;

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

beforeEach(() => clearCookies());

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCookies();
  vi.restoreAllMocks();
});

describe("ProductionAuthAdapter", () => {
  it("restores a session from the cookie-authenticated /auth/me response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => owner,
    });

    const session = await new ProductionAuthAdapter().restoreSession();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/me", {
      headers: { Accept: "application/json" },
    });
    expect(session?.user).toEqual(owner);
    // No client-readable token exists for a cookie-based session.
    expect(session?.token).toBeUndefined();
  });

  it("has no session to restore when /auth/me rejects the (missing) cookie", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    await expect(
      new ProductionAuthAdapter().restoreSession(),
    ).resolves.toBeNull();
  });

  it("treats a network failure during restore as no session, not an error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      new ProductionAuthAdapter().restoreSession(),
    ).resolves.toBeNull();
  });

  it("logs in with e-mail and password against the production endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: owner }),
    });

    const session = await new ProductionAuthAdapter().login(
      owner.email,
      "correct horse battery staple",
    );
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/login/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: owner.email,
        password: "correct horse battery staple",
      }),
    });
    expect(session.user).toEqual(owner);
    expect(session.token).toBeUndefined();
  });

  it("refuses to attempt login without a password", async () => {
    globalThis.fetch = vi.fn();
    await expect(
      new ProductionAuthAdapter().login(owner.email),
    ).rejects.toThrow("A jelszó megadása kötelező.");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("gives a specific message for wrong credentials (401)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      new ProductionAuthAdapter().login(owner.email, "wrong"),
    ).rejects.toThrow("Hibás e-mail cím vagy jelszó.");
  });

  it("gives a generic message for any other login failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(
      new ProductionAuthAdapter().login(owner.email, "whatever"),
    ).rejects.toThrow("A bejelentkezés sikertelen.");
  });

  it("logs out by calling the logout endpoint, tolerating network failure", async () => {
    document.cookie = "acropora_csrf=logout-csrf";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const session = {
      id: owner.id,
      user: owner,
      expiresAt: new Date().toISOString(),
    };
    await expect(
      new ProductionAuthAdapter().logout(session),
    ).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": "logout-csrf" },
    });
  });
});
