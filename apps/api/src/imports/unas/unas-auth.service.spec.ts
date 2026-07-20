import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { UnasApiClient } from "./unas-api.client.js";
import { UnasAuthService } from "./unas-auth.service.js";

const originalApiKey = process.env.UNAS_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.UNAS_API_KEY;
  else process.env.UNAS_API_KEY = originalApiKey;
});

describe("UnasAuthService", () => {
  it("caches a valid token and deduplicates concurrent login", async () => {
    process.env.UNAS_API_KEY = " secret-key ";
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
    const service = new UnasAuthService(api);

    assert.deepEqual(
      await Promise.all([service.getToken(), service.getToken()]),
      ["token-1", "token-1"],
    );
    assert.equal(await service.getToken(), "token-1");
    assert.equal(loginCount, 1);
    assert.equal(receivedKey, "secret-key");
  });

  it("refreshes a token inside the expiry safety margin", async () => {
    process.env.UNAS_API_KEY = "key";
    let loginCount = 0;
    const api = {
      login: async () => ({
        token: `token-${++loginCount}`,
        expireTime:
          Math.floor(Date.now() / 1000) + (loginCount === 1 ? 30 : 3600),
      }),
    } as unknown as UnasApiClient;
    const service = new UnasAuthService(api);

    assert.equal(await service.getToken(), "token-1");
    assert.equal(await service.getToken(), "token-2");
  });

  it("fails explicitly when the API key is missing", async () => {
    delete process.env.UNAS_API_KEY;
    const service = new UnasAuthService({} as UnasApiClient);
    await assert.rejects(service.getToken(), /UNAS_API_KEY_NOT_CONFIGURED/);
  });
});
