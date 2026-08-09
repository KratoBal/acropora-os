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
    });
    assert.deepEqual(calls, ["logout", "clearSession", "clearUserScopedQueries"]);
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
    });
    assert.equal(queriesCleared, true);
  });
});
