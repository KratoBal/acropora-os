import type { Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DevelopmentAuthAdapter } from "./development-auth";

const STORAGE_KEY = "acropora.development-session";
const validSession: Session = {
  id: "session-owner",
  token: "dev-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
  },
};

const originalFetch = globalThis.fetch;

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("DevelopmentAuthAdapter", () => {
  it("API-val validált, érvényes sessiont állít vissza", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validSession));
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      new DevelopmentAuthAdapter().restoreSession(),
    ).resolves.toEqual(validSession);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/me", {
      headers: { Authorization: "Bearer dev-token" },
    });
  });

  it("lejárt sessiont API-hívás nélkül eltávolít", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...validSession,
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    );
    globalThis.fetch = vi.fn();

    await expect(
      new DevelopmentAuthAdapter().restoreSession(),
    ).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("elérhetetlen API esetén biztonságosan törli a tárolt sessiont", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validSession));
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      new DevelopmentAuthAdapter().restoreSession(),
    ).resolves.toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("a development login API-sessiont tárol és ad vissza", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validSession,
    });

    await expect(
      new DevelopmentAuthAdapter().login("owner@acropora.local"),
    ).resolves.toEqual(validSession);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@acropora.local" }),
    });
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"),
    ).toEqual(validSession);
  });

  it("sikertelen development login esetén érthető hibát ad", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    await expect(
      new DevelopmentAuthAdapter().login("owner@acropora.local"),
    ).rejects.toThrow("A development login sikertelen.");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("API-hiba mellett is lokálisan kijelentkeztet", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validSession));
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      new DevelopmentAuthAdapter().logout(validSession),
    ).resolves.toBeUndefined();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
