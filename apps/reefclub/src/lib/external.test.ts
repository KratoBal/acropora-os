import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/config.json/route";

import { newRawNonce, sha256Hex } from "./nonce";
import { fetchPublicConfig, readPublicConfig } from "./public-config";

describe("the public settings", () => {
  it("reads the three runtime settings, trimmed, and an empty or missing one as off", () => {
    expect(
      readPublicConfig({
        REEFCLUB_GOOGLE_CLIENT_ID: " g.apps.example ",
        REEFCLUB_APPLE_CLIENT_ID: "hu.example.web",
        REEFCLUB_APPLE_REDIRECT_URI: "https://rc.example.test",
      }),
    ).toEqual({
      googleClientId: "g.apps.example",
      appleClientId: "hu.example.web",
      appleRedirectUri: "https://rc.example.test",
    });
    expect(readPublicConfig({ REEFCLUB_GOOGLE_CLIENT_ID: "  " })).toEqual({
      googleClientId: null,
      appleClientId: null,
      appleRedirectUri: null,
    });
  });

  it("the config route answers them from the runtime environment, never cached", async () => {
    vi.stubEnv("REEFCLUB_GOOGLE_CLIENT_ID", "g.apps.example");
    vi.stubEnv("REEFCLUB_APPLE_CLIENT_ID", "");
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      googleClientId: "g.apps.example",
      appleClientId: null,
      appleRedirectUri: null,
    });
    vi.unstubAllEnvs();
  });

  it("a failed or odd config answer means no external sign-in, never a thrown error", async () => {
    const none = {
      googleClientId: null,
      appleClientId: null,
      appleRedirectUri: null,
    };
    expect(
      await fetchPublicConfig(
        (async () =>
          new Response("x", { status: 500 })) as unknown as typeof fetch,
      ),
    ).toEqual(none);
    expect(
      await fetchPublicConfig((async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch),
    ).toEqual(none);
    expect(
      await fetchPublicConfig((async () =>
        Response.json({ googleClientId: 5 })) as unknown as typeof fetch),
    ).toEqual(none);
  });
});

describe("the Apple nonce", () => {
  it("is 64 hex characters, different each time", () => {
    const a = newRawNonce();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newRawNonce()).not.toBe(a);
  });

  it("is hashed to lowercase hex the way the server compares it (SHA-256 of the raw value)", async () => {
    const raw = "abc123";
    expect(await sha256Hex(raw)).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
  });
});
