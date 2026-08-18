import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resumeSession } from "./resume-session";
import type { AuthenticatedUser, StoredSession } from "./types";

const user: AuthenticatedUser = {
  id: "user-1",
  email: "owner@acropora.hu",
  displayName: "Teszt Owner",
  role: "OWNER",
};

const validSession: StoredSession = {
  token: "valid-token",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe("resumeSession", () => {
  it("returns to the session it already had, without asking the server", async () => {
    // The point of this whole function: no network call. A technician in
    // a basement must be able to get back into a session that is valid
    // and sitting on their own phone.
    const outcome = await resumeSession(
      {
        getSession: async () => validSession,
        clearSession: async () => {
          throw new Error("must not clear a valid session");
        },
        unlock: async () => "unlocked",
      },
      user,
    );
    assert.deepEqual(outcome, {
      type: "authenticated",
      user,
      expiresAt: validSession.expiresAt,
    });
  });

  it("stays locked when the owner was not confirmed, and keeps the session", async () => {
    let cleared = false;
    const outcome = await resumeSession(
      {
        getSession: async () => validSession,
        clearSession: async () => {
          cleared = true;
        },
        unlock: async () => "rejected",
      },
      user,
    );
    assert.deepEqual(outcome, { type: "locked", reason: "rejected" });
    assert.equal(cleared, false);
  });

  it("carries the reason through, so the screen knows what to offer", async () => {
    const outcome = await resumeSession(
      {
        getSession: async () => validSession,
        clearSession: async () => undefined,
        unlock: async () => "unavailable",
      },
      user,
    );
    assert.deepEqual(outcome, { type: "locked", reason: "unavailable" });
  });

  it("never prompts for a session that has already expired locally", async () => {
    let unlockCalled = false;
    let cleared = false;
    const outcome = await resumeSession(
      {
        getSession: async () => ({
          token: "stale",
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
        clearSession: async () => {
          cleared = true;
        },
        unlock: async () => {
          unlockCalled = true;
          return "unlocked";
        },
      },
      user,
    );
    assert.deepEqual(outcome, { type: "unauthenticated" });
    assert.equal(unlockCalled, false, "no point unlocking a dead session");
    assert.equal(cleared, true);
  });

  it("reports unauthenticated when the token vanished while backgrounded", async () => {
    const outcome = await resumeSession(
      {
        getSession: async () => null,
        clearSession: async () => undefined,
        unlock: async () => {
          throw new Error("must not prompt without a session");
        },
      },
      user,
    );
    assert.deepEqual(outcome, { type: "unauthenticated" });
  });

  it("uses the injected clock, so expiry is testable without waiting", async () => {
    const outcome = await resumeSession(
      {
        getSession: async () => ({
          token: "t",
          expiresAt: "2026-08-18T12:00:00.000Z",
        }),
        clearSession: async () => undefined,
        unlock: async () => "unlocked",
        now: () => Date.parse("2026-08-18T11:59:59.000Z"),
      },
      user,
    );
    assert.equal(outcome.type, "authenticated");
  });
});
