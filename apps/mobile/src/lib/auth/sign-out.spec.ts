import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signOut } from "./sign-out";

describe("signOut", () => {
  it("calls the server logout endpoint, then clears the local token", async () => {
    const calls: string[] = [];
    await signOut({
      logout: async () => {
        calls.push("logout");
      },
      clearSession: async () => {
        calls.push("clearSession");
      },
      clearUserScopedQueries: () => {
        calls.push("clearUserScopedQueries");
      },
      forgetOfflineData: async () => {
        calls.push("forgetOfflineData");
      },
    });
    assert.deepEqual(calls, [
      "logout",
      "clearSession",
      "clearUserScopedQueries",
      "forgetOfflineData",
    ]);
  });

  it("still clears the local token when the server call fails (network error or already-401)", async () => {
    let sessionCleared = false;
    await signOut({
      logout: async () => {
        throw new Error("network unreachable");
      },
      clearSession: async () => {
        sessionCleared = true;
      },
      clearUserScopedQueries: () => undefined,
      forgetOfflineData: async () => undefined,
    });
    assert.equal(sessionCleared, true);
  });

  it("clears every user-scoped query from the cache", async () => {
    let queriesCleared = false;
    await signOut({
      logout: async () => undefined,
      clearSession: async () => undefined,
      clearUserScopedQueries: () => {
        queriesCleared = true;
      },
      forgetOfflineData: async () => undefined,
    });
    assert.equal(queriesCleared, true);
  });

  it("clears user-scoped queries even when the server call fails", async () => {
    let queriesCleared = false;
    await signOut({
      logout: async () => {
        throw new Error("network unreachable");
      },
      clearSession: async () => undefined,
      clearUserScopedQueries: () => {
        queriesCleared = true;
      },
      forgetOfflineData: async () => undefined,
    });
    assert.equal(queriesCleared, true);
  });
});

describe("signOut és a helyszíni másolat", () => {
  /**
   * A KÉSZÜLÉKEN PARTNER-ESZKÖZÖK ADATAI ÜLNEK, hogy a szerelő térerő nélkül is
   * dolgozhasson. A telefon viszont gazdát cserél, és a mentett másolat nem
   * élheti túl azt a munkamenetet, amiben keletkezett.
   */
  it("drops the offline copy from the device", async () => {
    let forgotten = false;
    await signOut({
      logout: async () => undefined,
      clearSession: async () => undefined,
      clearUserScopedQueries: () => undefined,
      forgetOfflineData: async () => {
        forgotten = true;
      },
    });
    assert.equal(forgotten, true);
  });

  /**
   * A törlés HELYI művelet: attól, hogy a kijelentkezés hívása nem ért el a
   * szerverhez, az adat ugyanúgy le kell hogy kerüljön a készülékről.
   */
  it("drops it even when the server call fails", async () => {
    let forgotten = false;
    await signOut({
      logout: async () => {
        throw new Error("network unreachable");
      },
      clearSession: async () => undefined,
      clearUserScopedQueries: () => undefined,
      forgetOfflineData: async () => {
        forgotten = true;
      },
    });
    assert.equal(forgotten, true);
  });
});
