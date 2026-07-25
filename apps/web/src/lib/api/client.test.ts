import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "./client";

const originalFetch = globalThis.fetch;

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

beforeEach(() => clearCookies());

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCookies();
  vi.restoreAllMocks();
});

describe("apiRequest", () => {
  it("attaches a Bearer header when a real token is given (development login)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiRequest("/auth/me", "dev_abc123");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer dev_abc123",
        }),
      }),
    );
  });

  it("omits the Authorization header entirely when there is no token (cookie-based production session)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiRequest("/auth/me", "");

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("does not attach a CSRF header for a GET request even if the CSRF cookie is present", async () => {
    document.cookie = "acropora_csrf=csrf-token-value";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiRequest("/products", "");

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("X-CSRF-Token");
  });

  it("mirrors the CSRF cookie into the X-CSRF-Token header for a mutating request", async () => {
    document.cookie = "acropora_csrf=csrf-token-value";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiRequest("/products", "", { method: "POST", body: "{}" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(init.headers).toHaveProperty(
      "X-CSRF-Token",
      "csrf-token-value",
    );
  });

  it("sends no CSRF header on a mutating request when there is no CSRF cookie (development mode)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    await apiRequest("/products", "dev_abc123", { method: "POST" });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("X-CSRF-Token");
  });
});
