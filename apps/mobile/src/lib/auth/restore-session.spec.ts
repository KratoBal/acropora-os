import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { restoreSession } from "./restore-session";
import type { AuthenticatedUser, StoredSession } from "./types";

const testUser: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.hu",
  displayName: "Teszt Owner",
  role: "OWNER",
};

class FakeUnauthorizedError extends Error {
  status = 401;
}

class FakeNetworkError extends Error {
  // Deliberately has no `.status` — mirrors a raw fetch() rejection.
}

describe("restoreSession", () => {
  it("returns unauthenticated when there is no stored session, without calling the server", async () => {
    let getCurrentUserCalled = false;
    const outcome = await restoreSession({
      getSession: async () => null,
      clearSession: async () => undefined,
      getCurrentUser: async () => {
        getCurrentUserCalled = true;
        return testUser;
      },
    });
    assert.deepEqual(outcome, { type: "unauthenticated" });
    assert.equal(getCurrentUserCalled, false);
  });

  it("app start with a valid, non-expired token restores the session via /auth/me", async () => {
    const session: StoredSession = {
      token: "valid-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const outcome = await restoreSession({
      getSession: async () => session,
      clearSession: async () => {
        throw new Error("must not clear a valid session");
      },
      getCurrentUser: async () => testUser,
    });
    assert.deepEqual(outcome, {
      type: "authenticated",
      user: testUser,
      expiresAt: session.expiresAt,
    });
  });

  it("app start with a locally already-expired token clears it without calling /auth/me", async () => {
    const session: StoredSession = {
      token: "expired-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    };
    let cleared = false;
    let getCurrentUserCalled = false;
    const outcome = await restoreSession({
      getSession: async () => session,
      clearSession: async () => {
        cleared = true;
      },
      getCurrentUser: async () => {
        getCurrentUserCalled = true;
        return testUser;
      },
    });
    assert.deepEqual(outcome, { type: "unauthenticated" });
    assert.equal(cleared, true);
    assert.equal(getCurrentUserCalled, false);
  });

  it("app start with a token /auth/me rejects as 401 clears the token", async () => {
    const session: StoredSession = {
      token: "server-invalid-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    let cleared = false;
    const outcome = await restoreSession({
      getSession: async () => session,
      clearSession: async () => {
        cleared = true;
      },
      getCurrentUser: async () => {
        throw new FakeUnauthorizedError("unauthorized");
      },
    });
    assert.deepEqual(outcome, { type: "unauthenticated" });
    assert.equal(cleared, true);
  });

  it("a transient network error during /auth/me does not clear an otherwise-valid token", async () => {
    const session: StoredSession = {
      token: "valid-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    let cleared = false;
    const outcome = await restoreSession({
      getSession: async () => session,
      clearSession: async () => {
        cleared = true;
      },
      getCurrentUser: async () => {
        throw new FakeNetworkError("fetch failed");
      },
    });
    assert.deepEqual(outcome, { type: "network-error" });
    assert.equal(cleared, false);
  });

  describe("biometric gate", () => {
    const validSession: StoredSession = {
      token: "valid-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    it("does not send the token anywhere until the owner is confirmed", async () => {
      const order: string[] = [];
      const outcome = await restoreSession({
        getSession: async () => validSession,
        clearSession: async () => undefined,
        unlock: async () => {
          order.push("unlock");
          return "unlocked";
        },
        getCurrentUser: async () => {
          order.push("getCurrentUser");
          return testUser;
        },
      });
      assert.deepEqual(order, ["unlock", "getCurrentUser"]);
      assert.equal(outcome.type, "authenticated");
    });

    it("a rejected unlock locks the app without calling the server or discarding the session", async () => {
      let cleared = false;
      let getCurrentUserCalled = false;
      const outcome = await restoreSession({
        getSession: async () => validSession,
        clearSession: async () => {
          cleared = true;
        },
        unlock: async () => "rejected",
        getCurrentUser: async () => {
          getCurrentUserCalled = true;
          return testUser;
        },
      });
      assert.deepEqual(outcome, { type: "locked", reason: "rejected" });
      assert.equal(getCurrentUserCalled, false);
      // A cancelled prompt is not evidence that the session went bad.
      assert.equal(cleared, false);
    });

    it("locks a device that has no biometrics to offer, without discarding the session", async () => {
      let getCurrentUserCalled = false;
      const outcome = await restoreSession({
        getSession: async () => validSession,
        clearSession: async () => {
          throw new Error("must not clear a valid session");
        },
        unlock: async () => "unavailable",
        getCurrentUser: async () => {
          getCurrentUserCalled = true;
          return testUser;
        },
      });
      assert.deepEqual(outcome, { type: "locked", reason: "unavailable" });
      // The password form is the way in, so the token stays put and the
      // server is never told about a session the owner has not confirmed.
      assert.equal(getCurrentUserCalled, false);
    });

    it("never prompts for an already-expired session", async () => {
      let unlockCalled = false;
      const outcome = await restoreSession({
        getSession: async () => ({
          token: "stale-token",
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        clearSession: async () => undefined,
        unlock: async () => {
          unlockCalled = true;
          return "unlocked";
        },
        getCurrentUser: async () => testUser,
      });
      assert.deepEqual(outcome, { type: "unauthenticated" });
      assert.equal(unlockCalled, false);
    });

    it("behaves exactly as before when no gate is wired up", async () => {
      const outcome = await restoreSession({
        getSession: async () => validSession,
        clearSession: async () => undefined,
        getCurrentUser: async () => testUser,
      });
      assert.equal(outcome.type, "authenticated");
    });
  });
});
