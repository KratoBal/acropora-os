import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UnasApiClient } from "./unas-api.client.js";
import { UnasAuthService } from "./unas-auth.service.js";
import type {
  ResolvedUnasCredential,
  UnasCredentialProvider,
} from "./unas-credential.provider.js";
import type { UnasClock } from "./unas-login-expiry.js";

const provider = (
  resolve: () => Promise<ResolvedUnasCredential>,
): UnasCredentialProvider => ({ resolve }) as UnasCredentialProvider;
const clock = (nowMs: () => number = Date.now): UnasClock =>
  ({ nowMs }) as UnasClock;

describe("UnasAuthService", () => {
  it("caches a valid token and deduplicates concurrent login", async () => {
    let loginCount = 0;
    let receivedKey = "";
    const api = {
      login: async (apiKey: string) => {
        loginCount += 1;
        receivedKey = apiKey;
        await Promise.resolve();
        return {
          token: "token-1",
          expireTime: Math.floor(Date.now() / 1000) + 3600,
        };
      },
    } as unknown as UnasApiClient;
    const credentials = provider(async () => ({
      apiKey: "secret-key",
      revision: "database:1",
    }));
    const service = new UnasAuthService(api, credentials, clock());

    assert.deepEqual(
      await Promise.all([service.getToken(), service.getToken()]),
      ["token-1", "token-1"],
    );
    assert.equal(await service.getToken(), "token-1");
    assert.equal(loginCount, 1);
    assert.equal(receivedKey, "secret-key");
  });

  it("refreshes a token after a cached expiry enters the safety margin", async () => {
    let nowMs = Date.now();
    let loginCount = 0;
    const api = {
      login: async () => ({
        token: `token-${++loginCount}`,
        expireTime: Math.floor(nowMs / 1000) + 2 * 60 * 60,
      }),
    } as unknown as UnasApiClient;
    const service = new UnasAuthService(
      api,
      provider(async () => ({ apiKey: "key", revision: "database:1" })),
      clock(() => nowMs),
    );

    assert.equal(await service.getToken(), "token-1");
    nowMs += 2 * 60 * 60 * 1000 - 30_000;
    assert.equal(await service.getToken(), "token-2");
  });

  it("invalidates the token cache when the credential revision changes", async () => {
    let revision = 1;
    let loginCount = 0;
    const api = {
      login: async (apiKey: string) => ({
        token: `${apiKey}-token-${++loginCount}`,
        expireTime: Math.floor(Date.now() / 1000) + 3600,
      }),
    } as unknown as UnasApiClient;
    const service = new UnasAuthService(
      api,
      provider(async () => ({
        apiKey: `key-${revision}`,
        revision: `database:${revision}`,
      })),
      clock(),
    );

    assert.equal(await service.getToken(), "key-1-token-1");
    revision = 2;
    assert.equal(await service.getToken(), "key-2-token-2");
    assert.equal(loginCount, 2);
  });

  it("returns only an allowlisted code when credential resolution fails", async () => {
    const service = new UnasAuthService(
      {} as UnasApiClient,
      provider(async () => {
        throw new Error("raw credential failure secret-key");
      }),
      clock(),
    );
    await assert.rejects(service.getToken(), /UNAS_CONNECTION_FAILED/);
  });

  it("does not expose raw login failures", async () => {
    const service = new UnasAuthService(
      {
        login: async () => {
          throw new Error(
            "candidate-secret session-token SKU-PRIVATE <Error>raw</Error>",
          );
        },
      } as unknown as UnasApiClient,
      provider(async () => ({
        apiKey: "candidate-secret",
        revision: "database:1",
      })),
      clock(),
    );
    await assert.rejects(
      service.getToken(),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "UNAS_CONNECTION_FAILED" &&
        !error.message.includes("candidate-secret") &&
        !error.message.includes("session-token") &&
        !error.message.includes("SKU-PRIVATE"),
    );
  });

  it("rejects an expired login using the shared expiry policy", async () => {
    const nowMs = 2_000_000_000_000;
    const service = new UnasAuthService(
      {
        login: async () => ({
          token: "expired-token",
          expireTime: nowMs / 1000,
        }),
      } as unknown as UnasApiClient,
      provider(async () => ({
        apiKey: "candidate-secret",
        revision: "database:1",
      })),
      clock(() => nowMs),
    );
    await assert.rejects(
      service.getToken(),
      /UNAS_AUTH_RESPONSE_SHAPE_INVALID/,
    );
  });
});
