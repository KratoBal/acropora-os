import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReefClubProviderConfig } from "./reefclub-id-token.js";
import {
  type ReefClubFetch,
  ReefClubIdentityKeys,
} from "./reefclub-identity-keys.js";

const CONFIG: ReefClubProviderConfig = {
  provider: "GOOGLE",
  issuers: [],
  audiences: [],
  jwksUrl: "https://teszt.invalid/keys",
};

/** A key server whose answers the test sets, counting the requests. */
function server() {
  const state = {
    keys: [{ kty: "RSA", kid: "a" }] as Record<string, unknown>[],
    cacheControl: "public, max-age=600" as string | null,
    fail: false,
    requests: 0,
  };
  const fetcher: ReefClubFetch = async () => {
    state.requests++;
    if (state.fail)
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({}),
      };
    const keys = state.keys;
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "cache-control" ? state.cacheControl : null,
      },
      json: async () => ({ keys }),
    };
  };
  return { state, fetcher };
}

describe("ReefClub szolgáltatói kulcsok", () => {
  it("a lekért kulcskészletet a max-age-ig használja, kérés nélkül", async () => {
    const { state, fetcher } = server();
    let now = 1_000_000;
    const keys = new ReefClubIdentityKeys(fetcher, () => now);
    assert.equal((await keys.lookup(CONFIG, "a"))?.kid, "a");
    now += 9 * 60 * 1000;
    assert.equal((await keys.lookup(CONFIG, "a"))?.kid, "a");
    assert.equal(state.requests, 1);
    now += 2 * 60 * 1000; // past the 10 minutes
    await keys.lookup(CONFIG, "a");
    assert.equal(state.requests, 2);
  });

  it("ismeretlen kid egyszer újrakér (kulcscsere), de percenként legfeljebb egyszer", async () => {
    const { state, fetcher } = server();
    let now = 1_000_000;
    const keys = new ReefClubIdentityKeys(fetcher, () => now);
    await keys.lookup(CONFIG, "a");
    now += 61 * 1000;
    state.keys = [
      { kty: "RSA", kid: "a" },
      { kty: "RSA", kid: "b" },
    ];
    assert.equal((await keys.lookup(CONFIG, "b"))?.kid, "b");
    assert.equal(state.requests, 2);
    // a flood of made-up ids within the minute: no new request
    for (let i = 0; i < 20; i++)
      assert.equal(await keys.lookup(CONFIG, `kitalalt-${i}`), null);
    assert.equal(state.requests, 2);
  });

  it("sikertelen lekérés: a régi készlet marad, az új kid ismeretlen (zárva bukik)", async () => {
    const { state, fetcher } = server();
    let now = 1_000_000;
    const keys = new ReefClubIdentityKeys(fetcher, () => now);
    await keys.lookup(CONFIG, "a");
    state.fail = true;
    now += 11 * 60 * 1000;
    assert.equal((await keys.lookup(CONFIG, "a"))?.kid, "a");
    assert.equal(await keys.lookup(CONFIG, "b"), null);
  });

  it("készlet nélkül egy bukott lekérés nem enged át semmit, és percenként egyszer próbál újra", async () => {
    const { state, fetcher } = server();
    state.fail = true;
    let now = 1_000_000;
    const keys = new ReefClubIdentityKeys(fetcher, () => now);
    assert.equal(await keys.lookup(CONFIG, "a"), null);
    for (let i = 0; i < 10; i++)
      assert.equal(await keys.lookup(CONFIG, "a"), null);
    assert.equal(state.requests, 1, "a percen belül nincs újabb lekérés");
    now += 61 * 1000;
    state.fail = false;
    assert.equal((await keys.lookup(CONFIG, "a"))?.kid, "a");
    assert.equal(state.requests, 2);
  });

  it("a max-age korlátos: nulla sem kér minden belépésnél, egy év sem tart egy évig", async () => {
    const { state, fetcher } = server();
    state.cacheControl = "max-age=0";
    let now = 1_000_000;
    const keys = new ReefClubIdentityKeys(fetcher, () => now);
    await keys.lookup(CONFIG, "a");
    now += 4 * 60 * 1000;
    await keys.lookup(CONFIG, "a");
    assert.equal(state.requests, 1, "öt perc alatt nincs új kérés");

    const second = server();
    second.state.cacheControl = "max-age=31536000";
    let later = 1_000_000;
    const long = new ReefClubIdentityKeys(second.fetcher, () => later);
    await long.lookup(CONFIG, "a");
    later += 25 * 60 * 60 * 1000;
    await long.lookup(CONFIG, "a");
    assert.equal(second.state.requests, 2, "egy nap után újra kér");
  });
});
