import { describe, expect, it, vi } from "vitest";

import {
  csrfCookieName,
  errorMessageOf,
  ReefClubApiError,
  rc,
  readCookie,
} from "./api";

function answer(status: number, body?: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      }),
  ) as unknown as typeof fetch;
}

describe("the CSRF cookie", () => {
  it("has the __Host- name in production only, as the server names it", () => {
    expect(csrfCookieName("production")).toBe("__Host-rc_csrf");
    expect(csrfCookieName("development")).toBe("rc_csrf");
    expect(csrfCookieName(undefined)).toBe("rc_csrf");
  });

  it("is read by exact name, not by a prefix of another cookie", () => {
    expect(readCookie("rc_csrf", "x_rc_csrf=no; rc_csrf=abc%3D; other=1")).toBe(
      "abc=",
    );
    expect(readCookie("rc_csrf", "other=1")).toBeNull();
  });
});

describe("rc()", () => {
  it("sends the CSRF token on a change and not on a read", async () => {
    const fetchImpl = answer(204);
    await rc("POST", "/auth/logout", { fetchImpl, cookies: "rc_csrf=tok" });
    await rc("GET", "/me", { fetchImpl, cookies: "rc_csrf=tok" });
    const calls = vi.mocked(fetchImpl).mock.calls;
    expect(calls[0]![0]).toBe("/rc/v1/auth/logout");
    expect(calls[0]![1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": "tok" },
    });
    expect(
      (calls[1]![1]!.headers as Record<string, string>)["x-csrf-token"],
    ).toBeUndefined();
  });

  it("sends a JSON body with its content type, and none without a body", async () => {
    const fetchImpl = answer(202);
    await rc("POST", "/auth/register", {
      fetchImpl,
      cookies: "",
      body: { a: 1 },
    });
    const init = vi.mocked(fetchImpl).mock.calls[0]![1]!;
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
  });

  it("returns the parsed answer, and undefined for an empty one", async () => {
    expect(
      await rc("GET", "/me", { fetchImpl: answer(200, { email: "a@b.hu" }) }),
    ).toEqual({
      email: "a@b.hu",
    });
    expect(
      await rc("POST", "/auth/logout", { fetchImpl: answer(204), cookies: "" }),
    ).toBeUndefined();
  });

  it("raises the server's own message with the status", async () => {
    const error = await rc("POST", "/auth/login", {
      fetchImpl: answer(401, {
        statusCode: 401,
        message: "Hibás e-mail cím vagy jelszó.",
      }),
      cookies: "",
      body: {},
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReefClubApiError);
    expect(error).toMatchObject({
      status: 401,
      message: "Hibás e-mail cím vagy jelszó.",
    });
  });

  it("says the service is unreachable when the network fails, with status 0", async () => {
    const error = await rc("GET", "/me", {
      fetchImpl: (async () => {
        throw new TypeError("network");
      }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 0,
      message: expect.stringContaining("nem érhető el"),
    });
  });
});

describe("errorMessageOf()", () => {
  it("joins a validation list, and falls back by status", () => {
    expect(errorMessageOf(400, { message: ["a", "b"] })).toBe("a\nb");
    expect(errorMessageOf(429, {})).toMatch(/Túl sok/);
    expect(errorMessageOf(403, null)).toMatch(/Frissítsd/);
    expect(errorMessageOf(500, "<html>")).toMatch(/nem érhető el/);
  });
});
